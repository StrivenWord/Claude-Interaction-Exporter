// Where a rendered file goes.
//
// Every export path reduces to the same two steps: render an interaction to
// {filename, content, type}, then hand that to a destination. A destination
// owns the whole delivery — a download per file, or one ZIP for a batch — so
// no export path has to know which one it was given, and a new destination is
// a new implementation rather than an edit at every call site.
//
// Like utils.js this file is injected into claude.ai twice, by the manifest and
// again by background.js, so it must stay free of top-level const/let. It loads
// after utils.js everywhere and depends on it for sanitizeFilename.

// Hand a blob to the browser as a download. An anchor click rather than
// chrome.downloads, so this works from a content script as well as from the
// extension's own pages.
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Reserve a filename inside one destination. A name already taken would
// silently replace the earlier file in a ZIP, and scheduled tasks collide by
// design — every run of a routine shares its title, so runs on the same day
// produce the same dated slug.
//
// The preferred name is always tried first, so nothing changes for a file whose
// name is free. Only on a collision does this fall through to the alternatives
// the renderer supplied, which distinguish the file by when it ran and then by
// its id; the ordinal at the end exists so this always terminates, not because
// it tells anyone anything.
function claimFilename(taken, filename, alternatives) {
  const candidates = [filename, ...(alternatives || [])];

  for (const candidate of candidates) {
    const name = sanitizeFilename(candidate);
    if (name && !taken.has(name)) {
      taken.add(name);
      return name;
    }
  }

  const name = sanitizeFilename(filename);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';

  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${extension}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

// One file, saved as it arrives. Same-name collisions are left to the browser,
// which suffixes them itself rather than overwriting.
function downloadDestination() {
  return {
    async begin() {},

    async put(file) {
      const filename = sanitizeFilename(file.filename);
      saveBlob(new Blob([file.content], { type: file.type || 'application/octet-stream' }), filename);
      return filename;
    },

    async finish() {}
  };
}

// Everything into one archive, written when the batch finishes. JSZip is looked
// up at begin() rather than at load time: the browse page bundles it, while a
// content script has it injected on demand only once a batch starts.
function zipDestination({ archiveName, onProgress } = {}) {
  const taken = new Set();
  let zip = null;

  return {
    async begin() {
      if (typeof JSZip === 'undefined') {
        throw new Error('ZIP support is not loaded on this page.');
      }
      zip = new JSZip();
    },

    async put(file) {
      const filename = claimFilename(taken, file.filename, file.alternatives);
      // A renderer that already produced an archive says so, so its payload is
      // stored rather than deflated a second time to no purpose.
      zip.file(filename, file.content, file.compression ? { compression: file.compression } : undefined);
      return filename;
    },

    async finish(summary) {
      if (summary) {
        zip.file(claimFilename(taken, 'export_summary.json'), JSON.stringify(summary, null, 2));
      }

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      }, metadata => {
        if (onProgress) onProgress(Math.round(metadata.percent));
      });

      saveBlob(blob, sanitizeFilename(archiveName || 'claude-export.zip'));
    }
  };
}

// One file through the whole destination lifecycle. The single-row exports go
// through this rather than calling put() on its own, so a destination that has
// to set something up or flush at the end — anything talking to a remote
// service — works there too, without those call sites changing again.
async function deliverOne(destination, file) {
  await destination.begin();
  const filename = await destination.put(file);
  await destination.finish();
  return filename;
}

// Conversations and Cowork sessions are fetched a few at a time with a pause
// between groups, to stay well inside rate limits.
var BATCH_CONCURRENCY = 3;
var BATCH_PAUSE_MS = 200;

function itemLabel(item) {
  return item.name || item.title || item.uuid || item.id || '(unnamed)';
}

// Render many interactions into one destination. Progress and cancellation
// arrive as callbacks so the same engine drives the browse page's modal and the
// popup's status line, and one item failing is collected rather than aborting
// the run. Returns what happened; the caller decides how to say it.
async function runBatch({ items, renderItem, destination, noun = 'items', summary = {}, onProgress, shouldCancel }) {
  const total = items.length;
  const cancelRequested = () => Boolean(shouldCancel && shouldCancel());

  // Nothing to export writes nothing: an archive holding only its own summary
  // is a confusing thing to hand someone who filtered every row away.
  if (!total) {
    return { empty: true, cancelled: false, total: 0, completed: 0, skipped: 0, failed: 0, failures: [] };
  }

  const failures = [];
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  let cancelled = false;

  const report = (phase, percent) => {
    if (onProgress) onProgress({ phase, percent, total, completed, skipped, failed });
  };

  await destination.begin();
  report('rendering', 0);

  for (let i = 0; i < total; i += BATCH_CONCURRENCY) {
    if (cancelRequested()) {
      cancelled = true;
      break;
    }

    const group = items.slice(i, i + BATCH_CONCURRENCY);

    await Promise.all(group.map(async (item) => {
      const label = itemLabel(item);
      try {
        const file = await renderItem(item);
        if (!file) {
          skipped++;
          return;
        }
        await destination.put(file);
        completed++;
      } catch (error) {
        console.error(`Failed to export ${label}:`, error);
        failed++;
        failures.push({ label, message: error.message });
      }
    }));

    report('rendering', Math.round((completed + skipped + failed) / total * 100));

    if (i + BATCH_CONCURRENCY < total && !cancelRequested()) {
      await new Promise(resolve => setTimeout(resolve, BATCH_PAUSE_MS));
    }
  }

  // Asked again after the loop, not only at the top of each group: a batch
  // small enough to finish in one group, or a cancel during the last group,
  // passes that check and would otherwise go on to write the archive.
  if (cancelRequested()) {
    cancelled = true;
  }

  const result = { cancelled, total, completed, skipped, failed, failures };
  if (cancelled) {
    return result;
  }

  report('archiving', 0);
  await destination.finish({
    export_date: new Date().toISOString(),
    [`total_${noun}`]: total,
    successful_exports: completed,
    skipped_exports: skipped,
    failed_exports: failed,
    failed_items: failures.map(failure => `${failure.label}: ${failure.message}`),
    ...summary
  });

  return result;
}

// A one-line report of a finished batch, for a toast or the popup's status area.
function describeBatch(result, noun) {
  if (result.empty) {
    return `No ${noun} to export.`;
  }
  if (result.cancelled) {
    return 'Export cancelled';
  }
  if (result.failed > 0) {
    return `Exported ${result.completed} of ${result.total} ${noun} — ${result.failed} failed. ` +
      `See export_summary.json in the ZIP, or the console, for details.`;
  }
  if (result.skipped > 0) {
    return `Exported ${result.completed} ${noun}, ${result.skipped} left out.`;
  }
  return `Exported ${result.completed} ${noun}.`;
}
