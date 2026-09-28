// An artifact delivered with the conversation that produced it.
//
// The archive holds the document, the files the conversation wrote, the
// transcript in every format, a record naming every hash, and a verifier that
// checks the lot offline. The point is that the tie between the artifact and
// the chat is not asserted here — it is recomputable by whoever receives the
// archive, from the transcript in it, with no network and no trust in us.
//
// Needs JSZip and, through html.js, markdown-it; both are injected on demand.
// Free of top-level const/let for the same reason as utils.js.

async function renderProvenanceBundle(data, capture, opts = {}) {
  if (typeof JSZip === 'undefined') {
    throw new Error('ZIP support is not loaded on this page.');
  }

  const record = await buildProvenanceRecord(data, capture, opts);
  const artifacts = replayArtifacts(data);
  const name = data.name || data.uuid;

  const zip = new JSZip();
  const files = [];

  async function put(path, content, role) {
    zip.file(path, content);
    files.push({ path, sha256: await sha256Hex(content), bytes: byteLength(content), role });
  }

  // The document is the thing to open, so it sits at the top level and links to
  // the artifacts as siblings. Inside a bundle it keeps the identifiers a
  // standalone export withholds: here they are the evidence.
  const documentOpts = { ...opts, bundled: true, artifactLinks: 'relative' };
  await put('conversation.html', convertToHtml(data, documentOpts), 'derived');

  // The response exactly as it arrived. Everything else in the archive is
  // derived from this one file, including the artifacts.
  await put('transcript/conversation.json', capture.text, 'evidence');
  await put('transcript/conversation.md', convertToMarkdown(data, opts.includeMetadata, opts), 'derived');
  await put('transcript/conversation.txt', convertToText(data, opts.includeMetadata, opts), 'derived');

  for (const artifact of artifacts) {
    if (!artifact.functional_html) continue;
    await put(`artifact/${artifact.name}`, artifact.text, 'artifact');

    // A file published before later edits is a different file from the one the
    // conversation ended with, and both are worth keeping.
    if (artifact.published && artifact.published.differs_from_final) {
      const stem = artifact.name.replace(/\.[^.]+$/, '');
      const extension = (artifact.name.match(/\.[^.]+$/) || [''])[0];
      const step = artifact.chain[artifact.published.published_at_step];
      await put(`artifact/versions/${stem}.published${extension}`, step.result_text, 'artifact');
    }
  }

  record.files = files;
  zip.file('manifest.json', JSON.stringify(record, null, 2));
  zip.file('README.md', bundleReadme(record));
  zip.file('verify.html', await verifierSource());

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  return {
    content: blob,
    filename: buildDatedFilename(data.created_at, `${name} provenance`, 'zip'),
    alternatives: datedFilenameAlternatives(data.created_at, `${name} provenance`, data.uuid, 'zip'),
    type: 'application/zip',
    compression: 'STORE'
  };
}

// The verifier is a normal file in the extension rather than a string in here,
// so it can be edited and read like the page it is.
async function verifierSource() {
  const response = await fetch(chrome.runtime.getURL('verify.html'));
  return response.text();
}

// Written for someone who did not ask for any of this and has been handed a
// zip: what it is, how to check it, and what it does not prove.
function bundleReadme(record) {
  const source = record.source;
  const artifacts = record.artifacts;
  const proven = record.assurance.derivation === 'proven';

  const files = artifacts.map(artifact => {
    const lines = [`### ${artifact.name}`, '', `- ${artifact.bytes.toLocaleString()} bytes`, `- SHA-256 \`${artifact.sha256}\``];
    if (artifact.published) {
      lines.push(`- Published at ${artifact.published.url}`);
      if (artifact.published.differs_from_final) {
        lines.push(`- The published version is ${artifact.published.published_bytes.toLocaleString()} bytes — the conversation kept editing after publishing, so it is a different file. It is kept in \`artifact/versions/\`.`);
      }
    }
    if (artifact.verification.status !== 'reconstructed') {
      lines.push(`- **${artifact.verification.status.replace(/-/g, ' ')}** — ${artifact.verification.warnings.join('; ') || 'see manifest.json'}`);
    }
    return lines.join('\n');
  }).join('\n\n');

  return `# ${source.title}

This archive holds a conversation with Claude and the files it produced,
together, so the two can be checked against each other.

## What to open

- **\`conversation.html\`** — the conversation, as a page. Start here.
- **\`verify.html\`** — checks the archive. Works offline; nothing to install.
- \`artifact/\` — the files the conversation produced.
- \`transcript/\` — the conversation as data and as plain text.
- \`manifest.json\` — every hash and every step, in one file.

## How the checking works

When Claude writes a file, it does so through tool calls, and the transcript
records them with their arguments: the whole file when it is created, the exact
substitution when it is edited. Replaying those calls in order reproduces the
file — byte for byte.

That is what \`verify.html\` does. It hashes every file in the archive, replays
the conversation's own tool calls, and tells you whether the two agree. You can
also drop in a copy of the file you already have and ask whether it is the one
this conversation produced.

${proven
  ? 'Every file in this archive was reproduced exactly from the transcript.'
  : 'Not every file could be reproduced exactly from the transcript. `manifest.json` says which, and why.'}

## What this proves, and what it does not

**It proves the artifact and the transcript match.** Neither can be edited
without the other disagreeing, so tampering after the fact is detectable by
anyone, offline, indefinitely.

**It does not prove the conversation happened.** Anthropic does not sign
conversation data, so nothing here is a cryptographic guarantee that Claude
produced this output. What makes the archive hard to fake is that a forger
would have to produce a whole self-consistent transcript, not edit one file.

The archive records that this transcript was read from claude.ai's API on
${record.capture.fetched_at || 'the date in manifest.json'}. That is an
attestation by the exporter, not a proof.

## The conversation

- Title: ${source.title}
- Created: ${source.created_at}
- Updated: ${source.updated_at}
- Model: ${source.model}${source.model_source === 'inferred' ? ' (inferred from the conversation date, not reported by the API)' : ''}
- Messages: ${source.message_count}
- ${source.conversation_url}

## The files

${files || 'This conversation produced no files.'}

---

Made with Claude Interaction Exporter ${record.generator.version}.
`;
}
