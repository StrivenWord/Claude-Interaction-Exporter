// What a conversation produced, recovered from the conversation itself.
//
// When Claude writes a file it does so through tool calls, and the transcript
// records those calls with their arguments — the whole file on a create, the
// exact substitution on an edit. Replaying them in order reproduces the bytes
// the user downloaded, which is what lets an export prove an artifact came from
// a chat rather than merely assert it.
//
// Nothing here fetches or hashes; it reads the message tree and nothing else.
// The rendering in html.js and the manifest in the bundle both build on this.
//
// Like utils.js this file is injected into claude.ai twice, by the manifest and
// again by background.js, so it must stay free of top-level const/let. It loads
// after utils.js and depends on it for getCurrentBranch.

// Tool calls that write a file, reduced to four operations. The container route
// (create_file/str_replace) is what claude.ai emits today; the older in-chat
// `artifacts` tool is recognised so an export can refuse it clearly rather than
// silently producing an empty record.
function normalizeArtifactOp(block) {
  const name = block.name;
  const input = block.input || {};
  const common = { tool: name, tool_use_id: block.id, at: block.start_timestamp };

  if (name === 'create_file') {
    return { ...common, op: 'create', path: input.path, text: input.file_text || '' };
  }
  if (name === 'str_replace') {
    return { ...common, op: 'replace', path: input.path, old: input.old_str || '', new: input.new_str || '' };
  }
  if (name === 'Artifact' && (!input.action || input.action === 'publish')) {
    return { ...common, op: 'publish', path: input.file_path };
  }
  if (name === 'present_files') {
    const paths = input.filepaths || [];
    return { ...common, op: 'present', path: paths[0], paths };
  }
  if (name === 'artifacts') {
    return { ...common, op: 'unsupported', path: input.id };
  }
  return null;
}

// Every file-writing call on the current branch, in the order the transcript
// records it: message order, then position within the message. Not timestamp
// order — parallel calls can share a timestamp, and reordering edits changes
// what they produce.
function artifactOperations(data) {
  const ops = [];

  for (const message of getCurrentBranch(data)) {
    for (const block of message.content || []) {
      if (block.type !== 'tool_use') continue;
      const op = normalizeArtifactOp(block);
      if (!op || !op.path) continue;
      op.message_uuid = message.uuid;
      op.message_index = message.index;
      op.truncated = Boolean(message.truncated);
      ops.push(op);
    }
  }

  return ops;
}

// artifact_id, title and public URL, keyed by the path that was published.
function artifactPublications(data) {
  const published = {};

  for (const message of getCurrentBranch(data)) {
    for (const block of message.content || []) {
      if (block.type !== 'tool_result' || block.name !== 'Artifact') continue;
      const info = block.structured_content;
      if (info && info.path) published[info.path] = info;
    }
  }

  return published;
}

// A complete standalone document, as opposed to a fragment or a scratch file.
// Only these are worth writing out as files of their own; everything else stays
// in the record without becoming something to sort through.
function isFunctionalHtml(path, text) {
  if (!/\.x?html?$/i.test(String(path || ''))) return false;
  return /^\s*<(!doctype\s+html|html[\s>])/i.test(String(text || ''));
}

function basename(path) {
  return String(path || '').split('/').pop() || 'artifact';
}

// Rebuild every file the conversation wrote, recording how each step went.
//
// A replacement the transcript cannot pin down is the interesting failure: if
// old_str appears other than exactly once, the result is still produced but the
// artifact is marked ambiguous rather than presented as reconstructed.
function replayArtifacts(data) {
  const files = new Map();
  const published = artifactPublications(data);

  for (const op of artifactOperations(data)) {
    let file = files.get(op.path);
    if (!file) {
      file = { path: op.path, name: basename(op.path), text: null, chain: [], warnings: [], status: 'reconstructed' };
      files.set(op.path, file);
    }

    const step = {
      step: file.chain.length,
      op: op.op,
      tool: op.tool,
      tool_use_id: op.tool_use_id,
      at: op.at,
      message_uuid: op.message_uuid,
      message_index: op.message_index
    };

    if (op.truncated) {
      file.warnings.push(`message ${op.message_index} is marked truncated`);
      file.status = 'truncated-source';
    }

    if (op.op === 'unsupported') {
      file.status = 'unsupported-producer';
      file.warnings.push('written by the in-chat artifacts tool, which this export cannot replay');
    } else if (op.op === 'create') {
      file.text = op.text;
    } else if (op.op === 'replace') {
      if (file.text === null) {
        file.status = 'incomplete-chain';
        file.warnings.push(`${op.tool_use_id}: edit with no prior content`);
      } else {
        const occurrences = file.text.split(op.old).length - 1;
        step.occurrences = occurrences;
        if (occurrences !== 1) {
          file.status = 'ambiguous';
          file.warnings.push(`${op.tool_use_id}: old_str matches ${occurrences} times, expected 1`);
        }
        file.text = occurrences ? file.text.replace(op.old, op.new) : file.text;
      }
    }

    if (file.text !== null) {
      step.result_bytes = byteLength(file.text);
      step.result_text = file.text;
    }

    file.chain.push(step);
  }

  for (const file of files.values()) {
    const info = published[file.path];
    if (info) {
      // Publishing happens at a point in the chain, not at the end, so the
      // published bytes are whatever stood at that step — frequently not the
      // final file.
      const at = file.chain.findIndex(step => step.op === 'publish');
      file.published = {
        artifact_id: info.artifact_id,
        url: info.url,
        title: info.title,
        published_at_step: at,
        published_bytes: at >= 0 ? file.chain[at].result_bytes : undefined
      };
      file.published.differs_from_final =
        file.text !== null && file.published.published_bytes !== byteLength(file.text);
    }

    file.bytes = file.text === null ? 0 : byteLength(file.text);
    file.functional_html = isFunctionalHtml(file.path, file.text);
    file.produced_by_message = file.chain.length ? file.chain[file.chain.length - 1].message_uuid : null;
  }

  return [...files.values()];
}

// UTF-8 length, since every byte count in a record has to agree with what a
// verifier would measure on the file itself.
function byteLength(text) {
  return new TextEncoder().encode(String(text ?? '')).length;
}

// Which artifacts each message produced, for the badge on a collapsed reply and
// the marker beside the turn that wrote something.
function artifactsByMessage(artifacts) {
  const byMessage = new Map();

  for (const artifact of artifacts) {
    for (const step of artifact.chain) {
      if (step.op !== 'create' && step.op !== 'replace' && step.op !== 'present') continue;
      const list = byMessage.get(step.message_uuid) || [];
      if (!list.includes(artifact)) list.push(artifact);
      byMessage.set(step.message_uuid, list);
    }
  }

  return byMessage;
}

// How many tool calls a message made, for the summary of a reply that did work
// without producing a file.
function toolCallCount(message) {
  return (message.content || []).filter(block => block.type === 'tool_use').length;
}

// --- the bundle --------------------------------------------------------
// A conversation, the files it produced, and enough of a record that someone
// who was not there can check the two against each other.

var PROVENANCE_VERSION = 1;

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// The chain points into the transcript rather than restating it: a step names
// the message and the tool call to look in. The transcript stays the single
// source, so the record and the evidence cannot drift apart.
async function artifactRecord(artifact) {
  const chain = [];
  for (const step of artifact.chain) {
    const { result_text, ...rest } = step;
    chain.push(result_text === undefined ? rest : { ...rest, result_sha256: await sha256Hex(result_text) });
  }

  const record = {
    name: artifact.name,
    path: artifact.functional_html ? `artifact/${artifact.name}` : null,
    source_path: artifact.path,
    media_type: artifact.functional_html ? 'text/html' : 'text/plain',
    bytes: artifact.bytes,
    sha256: await sha256Hex(artifact.text),
    bytes_from: 'replay',
    producer: 'container-files',
    functional_html: artifact.functional_html,
    chain,
    verification: { method: 'replay', status: artifact.status, warnings: artifact.warnings }
  };

  if (artifact.published) {
    record.published = artifact.published;
  }

  return record;
}

async function buildProvenanceRecord(data, capture, opts = {}) {
  const artifacts = replayArtifacts(data);
  const records = [];
  for (const artifact of artifacts) {
    records.push(await artifactRecord(artifact));
  }

  const branch = getCurrentBranch(data);

  return {
    provenance_version: PROVENANCE_VERSION,
    generated_at: new Date().toISOString(),
    generator: { name: 'Claude Interaction Exporter', version: extensionVersion() },

    source: {
      platform: data.platform || 'CLAUDE_AI',
      conversation_id: data.uuid || '',
      conversation_url: `https://claude.ai/chat/${data.uuid || ''}`,
      title: data.name || 'Untitled Conversation',
      created_at: data.created_at || '',
      updated_at: data.updated_at || '',
      model: data.model || '',
      model_source: data.model_source || (data.model ? 'reported' : 'inferred'),
      branch_leaf_message_uuid: data.current_leaf_message_uuid || '',
      message_count: branch.length,
      truncated_messages: branch.filter(message => message.truncated).map(message => message.uuid)
    },

    capture: {
      endpoint: capture.url || '',
      organization_id: opts.orgId || '',
      fetched_at: capture.fetched_at || '',
      response_bytes: byteLength(capture.text),
      response_sha256: await sha256Hex(capture.text)
    },

    // Everything the exporter or the operator added, kept apart from what the
    // API returned so the record never passes off an inference as a reading.
    annotations: {
      project: opts.project || '',
      contributor: opts.contributor || '',
      tags: normalizeTags(opts.tags)
    },

    artifacts: records,
    files: [],
    assurance: {
      derivation: derivationLevel(records),
      capture: 'attested',
      external: 'unchecked',
      time_anchor: 'none'
    }
  };
}

function derivationLevel(records) {
  if (!records.length) return 'none';
  return records.every(record => record.verification.status === 'reconstructed') ? 'proven' : 'partial';
}

function extensionVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch (error) {
    return '';
  }
}
