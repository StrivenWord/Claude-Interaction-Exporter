// Shared utility functions for Claude Exporter
//
// This file is injected into claude.ai twice — once by the manifest's
// content_scripts and again by background.js for tabs that were already open.
// Keep it free of top-level const/let: a duplicate declaration is a parse-time
// error that would abort the whole re-injection, leaving a stale copy live.

// Escape a string for safe insertion into innerHTML — both as text content
// and inside a quoted attribute value (conversation titles are user-authored
// and get inserted directly into the browse table's markup; see upstream
// issue #12 for the DOM XSS this closes).
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The loaded build's version_name, so which one is running can be confirmed at
// a glance after a reload. Shown by the popup, the options page and the browse
// page, and set before anything those pages fetch, so a slow or failing request
// can't be what hides it.
function showVersion(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;
  const manifest = chrome.runtime.getManifest();
  element.textContent = manifest.version_name || `v${manifest.version}`;
}

// Strip characters that are invalid in filenames on Windows or would create
// unintended directories inside an export ZIP.
function sanitizeFilename(name) {
  return String(name ?? '').replace(/[<>:"/\\|?*]/g, '_');
}

// Helper function to reconstruct the current branch from the message tree
function getCurrentBranch(data) {
  if (!data.chat_messages || !data.current_leaf_message_uuid) {
    return [];
  }

  // Create a map of UUID to message for quick lookup
  const messageMap = new Map();
  data.chat_messages.forEach(msg => {
    messageMap.set(msg.uuid, msg);
  });

  // Trace back from the current leaf to the root
  const branch = [];
  let currentUuid = data.current_leaf_message_uuid;

  while (currentUuid && messageMap.has(currentUuid)) {
    const message = messageMap.get(currentUuid);
    branch.unshift(message); // Add to beginning to maintain order
    currentUuid = message.parent_message_uuid;

    // Stop if we hit the root (parent UUID that doesn't exist in our messages)
    if (!messageMap.has(currentUuid)) {
      break;
    }
  }

  return branch;
}

// Default model timeline for conversations the API returns with a null model.
// Each entry is the date that model became the default for new conversations.
var DEFAULT_MODEL_TIMELINE = [
  { date: new Date('2024-01-01'), model: 'claude-3-sonnet-20240229' },
  { date: new Date('2024-06-20'), model: 'claude-3-5-sonnet-20240620' },
  { date: new Date('2024-10-22'), model: 'claude-3-5-sonnet-20241022' },
  { date: new Date('2025-02-24'), model: 'claude-3-7-sonnet-20250219' },
  { date: new Date('2025-05-22'), model: 'claude-sonnet-4-20250514' },
  { date: new Date('2025-09-29'), model: 'claude-sonnet-4-5-20250929' },
  { date: new Date('2026-02-17'), model: 'claude-sonnet-4-6' }
];

// Settle a conversation's model and record where it came from. The API returns
// null for anything that used the default model of its day, so the value below
// is sometimes a dated guess — and an export that writes a guess exactly like a
// reported value is asserting something it does not know.
function applyModel(conversation) {
  conversation.model_source = conversation.model ? 'reported' : 'inferred';
  conversation.model = inferModel(conversation);
  return conversation;
}

// Infer the model for conversations with a null model, based on creation date.
function inferModel(conversation) {
  if (conversation.model) {
    return conversation.model;
  }

  const conversationDate = new Date(conversation.created_at);
  for (let i = DEFAULT_MODEL_TIMELINE.length - 1; i >= 0; i--) {
    if (conversationDate >= DEFAULT_MODEL_TIMELINE[i].date) {
      return DEFAULT_MODEL_TIMELINE[i].model;
    }
  }

  return DEFAULT_MODEL_TIMELINE[0].model;
}

// --- frontgraph: the frontmatter is the graph --------------------------
// A browser export is post-hoc and mechanical: it shapes the frontmatter
// shell and scrapes what the API returns for free, but it never reads the
// transcript, so anything requiring judgment — tags, contributor — is typed
// into the export UI rather than derived.

function slugify(text) {
  const slug = (text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'untitled';
}

// Every format's filename is built from this now, not just Markdown's, so a
// present-but-unparseable created_at falls back rather than throwing and
// failing the export outright.
function formatDateYYYYMMDD(isoString) {
  const date = isoString ? new Date(isoString) : new Date(0);
  return (Number.isNaN(date.getTime()) ? new Date(0) : date).toISOString().slice(0, 10);
}

// Quote a scalar for safe YAML embedding. Titles, contributor names, and
// summaries are either user-typed or pulled from free-text API fields, so
// they may contain ": ", quotes, or a stray newline from pasted text — all
// three break an unescaped double-quoted scalar, which is why every field
// built from one of those sources must route through here rather than being
// interpolated into renderFrontmatter's pairs directly.
function yamlScalar(value) {
  const str = String(value ?? '');
  return `"${str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/\t/g, '\\t')}"`;
}

// Collapse a multi-paragraph API string (e.g. summary) to one safe YAML line
function collapseWhitespace(str) {
  return String(str ?? '').replace(/\s+/g, ' ').trim();
}

// Tags are typed by hand at export time, so take whatever the field holds and
// clean it rather than rejecting it: split on commas, drop the "#" Obsidian
// users reflexively prefix, hyphenate interior spaces, and strip anything
// outside the character set Obsidian accepts in a tag. Returns a deduped,
// lowercased array so "Research, research" can't split the graph in two.
function normalizeTags(input) {
  const raw = Array.isArray(input) ? input.join(',') : String(input ?? '');
  const seen = new Set();
  const tags = [];

  for (const candidate of raw.split(',')) {
    const tag = candidate
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_/-]+/gu, '')
      .replace(/^[-/]+|[-/]+$/g, '');

    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }

  return tags;
}

// Obsidian's own frontmatter shape: a block sequence under the key. Sanitized
// tags and model ids only hold letters, digits, _, - and /, so the only items
// needing quotes are those a YAML parser would read as a number, date or
// boolean.
function yamlList(key, items) {
  if (!items.length) {
    return `${key}: []`;
  }
  const ambiguous = /^([\d-]+|true|false|yes|no|on|off|null)$/i;
  const lines = items.map(item => `  - ${ambiguous.test(item) ? yamlScalar(item) : item}`);
  return [`${key}:`, ...lines].join('\n');
}

// JSON exports carry the same tags the markdown frontmatter would, as an array.
function withExportTags(data, tags) {
  return { ...data, tags: normalizeTags(tags) };
}

// Bumped when a field in buildFrontgraphFrontmatter/buildTaskFrontmatter is
// added, renamed, or reinterpreted, so a parser reading an export later can
// tell which shape it's looking at. Not a per-document revision counter —
// the same export never changes after being written, only future exports do.
// var, not const: this file is injected twice (see the file header), and a
// duplicate top-level const/let would throw on the second injection.
var FRONTGRAPH_VERSION = 2;

// Emit a frontmatter block from ordered [key, value] pairs. Values arrive
// pre-formatted — wrap anything user-authored in yamlScalar first. A null value
// drops the key entirely, so exports of different source types share one shell
// without carrying each other's empty fields, and an array value expands into
// Obsidian's block sequence.
function renderFrontmatter(pairs) {
  const lines = ['---'];
  for (const [key, value] of pairs) {
    if (value === null || value === undefined) continue;
    lines.push(Array.isArray(value) ? yamlList(key, value) : `${key}: ${value}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

// Filename convention: [YYYY-MM-DD]-[slug].[ext]
function buildDatedFilename(createdAt, name, extension) {
  return `${formatDateYYYYMMDD(createdAt)}-${slugify(name)}.${extension}`;
}

// UTC hour and minute, matching formatDateYYYYMMDD's timezone so a date and a
// time in one filename can't disagree. Empty when there is no usable timestamp.
function formatTimeHHMM(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(11, 16).replace(':', '-');
}

// Names a file may fall back to when its preferred one is already taken inside
// one destination. The default convention above never changes; these only come
// into play on a collision, and each distinguishes the file by something real
// before deliver.js resorts to a bare ordinal — first the time it ran, which is
// what actually separates two runs of one scheduled routine on one day, then
// its own id, which cannot repeat.
function datedFilenameAlternatives(createdAt, name, id, extension) {
  const date = formatDateYYYYMMDD(createdAt);
  const slug = slugify(name);
  const alternatives = [];

  const time = formatTimeHHMM(createdAt);
  if (time) {
    alternatives.push(`${date}T${time}-${slug}.${extension}`);
  }
  if (id) {
    alternatives.push(`${date}-${slug}-${slugify(id)}.${extension}`);
  }

  return alternatives;
}

// Fields the API supplies are scraped: summary, and project — via
// project_name on conversations that belong to a Claude.ai Project, or the
// literal "None" when a conversation isn't in one. created/updated preserve
// the API's own created_at/updated_at verbatim, alongside the derived
// YYYY-MM-DD date used for the filename. project, contributor and tags come
// from the export UI, which overrides the scraped project.
function buildFrontgraphFrontmatter(data, opts = {}) {
  // API shape is inconsistent across endpoints: the single-conversation
  // fetch (used here at export time) returns a flat project_name, but the
  // bulk list endpoint returns a nested project: {uuid, name} instead.
  // Check both so this doesn't silently break if that ever flips.
  const project = opts.project || data.project_name || (data.project && data.project.name) || 'None';
  return renderFrontmatter([
    ['title', yamlScalar(data.name || 'Untitled Conversation')],
    ['date', formatDateYYYYMMDD(data.created_at)],
    ['created', yamlScalar(data.created_at || '')],
    ['updated', yamlScalar(data.updated_at || '')],
    ['type', 'conversation'],
    ['status', 'reference'],
    ['frontgraph-version', FRONTGRAPH_VERSION],
    ['project', yamlScalar(project)],
    ['contributor', yamlScalar(opts.contributor || '')],
    ['tags', normalizeTags(opts.tags)],
    ['source', 'claude-conversation'],
    ['source-url', yamlScalar(`https://claude.ai/chat/${data.uuid || ''}`)],
    ['model', yamlScalar(data.model || '')],
    ['model-source', data.model_source || (data.model ? 'reported' : 'inferred')],
    ['session-id', yamlScalar(data.uuid || '')],
    ['summary', yamlScalar(collapseWhitespace(data.summary))]
  ]);
}

// Turns are the common shape every transcript reduces to before rendering.
// Conversations derive them from the message tree, Cowork sessions from the
// event log. A turn keeps its content blocks separately from the joined text
// because the two formats join them differently: markdown puts a blank line
// between blocks, plain text runs them together.
function conversationTurns(data) {
  return getCurrentBranch(data).map(message => {
    const blocks = message.content
      ? message.content.map(block => block.text).filter(Boolean)
      : (message.text ? [message.text] : []);

    return {
      role: message.sender === 'human' ? 'user' : 'assistant',
      blocks,
      text: blocks.join(''),
      created_at: message.created_at,
      attachments: message.attachments || []
    };
  });
}

// Plain text uses the full speaker label on first appearance, then abbreviates.
function formatPlainTurns(turns) {
  let humanSeen = false;
  let assistantSeen = false;

  return turns.map(turn => {
    let label;
    if (turn.role === 'user') {
      label = humanSeen ? 'H' : 'Human';
      humanSeen = true;
    } else {
      label = assistantSeen ? 'A' : 'Assistant';
      assistantSeen = true;
    }
    return `${label}: ${turn.text}\n`;
  }).join('\n').trim();
}

// Convert to markdown format
function convertToMarkdown(data, includeMetadata, frontmatterOpts) {
  let markdown = buildFrontgraphFrontmatter(data, frontmatterOpts || {});
  markdown += `# ${data.name || 'Untitled Conversation'}\n\n`;

  if (includeMetadata) {
    markdown += `**Created:** ${new Date(data.created_at).toLocaleString()}\n`;
    markdown += `**Updated:** ${new Date(data.updated_at).toLocaleString()}\n`;
    markdown += `**Model:** ${data.model}\n`;
    if (data.truncated !== undefined) {
      markdown += `**Truncated:** ${data.truncated}\n`;
    }
    markdown += '\n---\n\n';
  }

  for (const turn of conversationTurns(data)) {
    markdown += `${turn.role === 'user' ? '**You**' : '**Claude**'}:\n\n`;

    // Show attachments if metadata enabled
    if (includeMetadata && turn.attachments.length > 0) {
      for (const attachment of turn.attachments) {
        markdown += `> **Attachment:** ${attachment.file_name || '(unnamed)'}`;
        if (attachment.file_size) {
          const sizeKB = (attachment.file_size / 1024).toFixed(1);
          markdown += ` (${sizeKB} KB)`;
        }
        if (attachment.file_type) {
          markdown += ` [${attachment.file_type}]`;
        }
        markdown += '\n';
        if (attachment.extracted_content) {
          markdown += `>\n> <details><summary>Extracted content</summary>\n>\n> \`\`\`\n> ${attachment.extracted_content.replace(/\n/g, '\n> ')}\n> \`\`\`\n>\n> </details>\n`;
        }
      }
      markdown += '\n';
    }

    if (turn.blocks.length) {
      markdown += `${turn.blocks.join('\n\n')}\n\n`;
    }

    if (includeMetadata && turn.created_at) {
      markdown += `*${new Date(turn.created_at).toLocaleString()}*\n\n`;
    }

    markdown += '---\n\n';
  }

  return markdown;
}

// Convert to plain text
function convertToText(data, includeMetadata, opts = {}) {
  let text = '';

  // Add metadata header if requested
  if (includeMetadata) {
    const tags = normalizeTags(opts.tags);
    text += `${data.name || 'Untitled Conversation'}\n`;
    text += `Created: ${new Date(data.created_at).toLocaleString()}\n`;
    text += `Updated: ${new Date(data.updated_at).toLocaleString()}\n`;
    text += `Model: ${data.model}\n`;
    if (tags.length) {
      text += `Tags: ${tags.join(', ')}\n`;
    }
    text += '\n---\n\n';
  }

  return text + formatPlainTurns(conversationTurns(data));
}

// One place decides what a chosen export format produces, so the popup, the
// single-row export and the batch ZIP can't drift apart on filename or MIME.
// The task equivalent is renderTaskExport; the two stay deliberately
// symmetrical, including the [YYYY-MM-DD]-[slug] filename in every format.
async function renderConversationExport(data, format, opts = {}) {
  const name = data.name || data.uuid;

  switch (format) {
    case 'markdown':
      return {
        content: convertToMarkdown(data, opts.includeMetadata, opts),
        filename: buildDatedFilename(data.created_at, name, 'md'),
        alternatives: datedFilenameAlternatives(data.created_at, name, data.uuid, 'md'),
        type: 'text/markdown'
      };
    case 'text':
      return {
        content: convertToText(data, opts.includeMetadata, opts),
        filename: buildDatedFilename(data.created_at, name, 'txt'),
        alternatives: datedFilenameAlternatives(data.created_at, name, data.uuid, 'txt'),
        type: 'text/plain'
      };
    case 'html':
      return {
        content: convertToHtml(data, opts),
        filename: buildDatedFilename(data.created_at, name, 'html'),
        alternatives: datedFilenameAlternatives(data.created_at, name, data.uuid, 'html'),
        type: 'text/html'
      };
    case 'provenance':
      return renderProvenanceBundle(data, opts.capture, opts);
    default:
      return {
        content: JSON.stringify(withExportTags(data, opts.tags), null, 2),
        filename: buildDatedFilename(data.created_at, name, 'json'),
        alternatives: datedFilenameAlternatives(data.created_at, name, data.uuid, 'json'),
        type: 'application/json'
      };
  }
}

// --- Cowork sessions (scheduled tasks) --------------------------------
// Tasks run as Cowork sessions (cse_… ids) rather than chat conversations, and
// are read from a replayable event log instead of a message tree. api.js owns
// the reading; everything below turns that log into the same turns/frontmatter
// shape the conversation exports use.

// Pure bookkeeping: sandbox, hook and quota chatter with no transcript in it
// at all. These are dropped outright. Everything else is classified by
// coworkEventRole rather than assumed to be speech.
var COWORK_LOG_EVENT_TYPES = [
  'env_manager_log',
  'system',
  'active_goal',
  'autocompact_state',
  'rate_limit_event',
  'ping',
  'presence'
];

// The scheduler appends its own context to the prompt it fires. That belongs in
// frontmatter, not in the transcript body — but only there: applied to every
// text block, as it once was, this silently deletes the same markup out of a
// tool result that merely quoted it, such as a file a task happened to read.
function stripSystemReminders(text) {
  return String(text ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

// A web search's results arrive as their own block type — a list of pages
// rather than text — so they fall through every text path. They are exactly
// the provenance a research task is worth keeping, so they are kept as links.
function coworkSearchResults(content) {
  if (!Array.isArray(content)) return [];

  return content
    .filter(result => result && (result.url || result.title))
    .map(result => ({
      title: collapseWhitespace(result.title || '') || result.url,
      url: result.url || ''
    }));
}

// An image block carries either a URL or inline base64 data. Only a URL can
// become a reference; this extension saves text and never downloads files, so
// inline data is recorded as having been there rather than embedded.
function coworkImageRef(block) {
  const source = block.source || {};
  return { url: source.url || '', media_type: source.media_type || 'image' };
}

// A tool_result's content is a bare string or a nested block array.
function coworkBlockText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(block => (typeof block === 'string' ? block : block && block.text))
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

// Flatten one event's content into the parts an export renders. Both sides of a
// session speak in Anthropic content blocks — the exception is the fired prompt,
// which arrives as a bare string. A single assistant event routinely carries
// prose and tool calls together, and tool results come back as user events, so
// text and tool activity have to stay distinguishable rather than collapsing
// into one string.
function coworkParts(payload, opts = {}) {
  if (!payload) return [];

  // Only the fired prompt carries the scheduler's appended context.
  const clean = opts.stripReminders
    ? text => stripSystemReminders(text)
    : text => String(text ?? '').trim();

  const content = (payload.message && payload.message.content) ?? payload.content ?? payload.text;

  if (typeof content === 'string') {
    const text = clean(content);
    return text ? [{ kind: 'text', text }] : [];
  }
  if (!Array.isArray(content)) return [];

  const parts = [];

  for (const block of content) {
    if (typeof block === 'string') {
      const text = clean(block);
      if (text) parts.push({ kind: 'text', text });
      continue;
    }
    if (!block) continue;

    if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      parts.push({ kind: 'tool_use', name: block.name || 'tool', input: block.input, id: block.id || '' });
    } else if (block.type === 'tool_result') {
      const text = coworkBlockText(block.content);
      if (text) parts.push({ kind: 'tool_result', text, id: block.tool_use_id || '' });
    } else if (block.type === 'web_search_tool_result') {
      const results = coworkSearchResults(block.content);
      if (results.length) parts.push({ kind: 'search_results', results, id: block.tool_use_id || '' });
    } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      const text = block.type === 'redacted_thinking' ? '[redacted]' : clean(block.thinking);
      if (text) parts.push({ kind: 'thinking', text });
    } else if (block.type === 'image') {
      parts.push({ kind: 'image', ...coworkImageRef(block) });
    } else if (block.text) {
      const text = clean(block.text);
      if (text) parts.push({ kind: 'text', text });
    } else if (block.type) {
      // A block shape this build doesn't recognize is carried through rather
      // than dropped. Every earlier version of this parser silently discarded
      // whatever it hadn't been taught, which is how thinking blocks, images
      // and search results went missing; keeping them means a JSON export is a
      // complete record even of content only a later build can render.
      parts.push({ kind: 'unknown', type: block.type, block });
    }
  }

  return parts;
}

// Who, if anyone, spoke. An explicit role settles it; failing that, a plain
// user or assistant event is speech. Anything else is the environment around
// the conversation and returns null.
//
// This is deliberately the opposite way round from the old denylist. Under
// that, an event type this build had never seen fell through to 'assistant'
// and was rendered as something Claude said — so a new kind of bookkeeping
// event would have quietly invented dialogue. Being unsure now produces a
// labelled environment note instead, which is the safe direction to fail in.
function coworkEventRole(event) {
  const role = event.payload && event.payload.message && event.payload.message.role;
  if (role === 'user' || role === 'assistant') return role;
  if (event.event_type === 'user') return 'user';
  if (event.event_type === 'assistant') return 'assistant';
  return null;
}

// Turns keep their classification rather than only their role, so every
// renderer — and anything reading a JSON export later — can separate what was
// said from what merely happened, without re-deriving it from event types.
function coworkTurns(events) {
  const turns = [];
  // The fired prompt is the session's first user event, and the only place the
  // scheduler's appended context appears.
  const kickoff = events.find(event => event.event_type === 'user') || null;

  for (const event of events) {
    if (COWORK_LOG_EVENT_TYPES.includes(event.event_type)) continue;

    const parts = coworkParts(event.payload, { stripReminders: event === kickoff });
    if (!parts.length) continue;

    const role = coworkEventRole(event);

    turns.push({
      kind: role ? 'message' : 'environment',
      role,
      event_type: event.event_type || null,
      parts,
      // Joined prose, for the plain-text renderer and for turn-level checks.
      text: parts.filter(part => part.kind === 'text').map(part => part.text).join('\n\n'),
      created_at: event.created_at
    });
  }

  return turns;
}

// Reduce an event log to the record an export needs. The scheduler identifies
// itself in the first user event: inbound_origin marks a run as fired rather
// than started by hand, and the appended system reminder names the routine and
// its trigger. Falling back to the prompt's first line keeps ad-hoc Cowork
// sessions titled sensibly too.
function summariseCoworkSession(sessionId, events, opts = {}) {
  const kickoff = events.find(event => event.event_type === 'user') || null;
  const payload = (kickoff && kickoff.payload) || {};
  const rawPrompt = (payload.message && payload.message.content) || '';
  const reminder = /<system-reminder>([\s\S]*?)<\/system-reminder>/.exec(rawPrompt);
  const context = reminder ? reminder[1] : '';

  const routine = (/routine\s+"([^"]+)"/.exec(context) || [])[1] || null;
  const triggerId = (/trigger_id:\s*([A-Za-z0-9_]+)/.exec(context) || [])[1] || null;
  const prompt = typeof rawPrompt === 'string' ? stripSystemReminders(rawPrompt) : '';
  const turns = coworkTurns(events);

  // Every model that answered, in the order they first appear. A long session
  // can change model part way through — a fallback, or a compaction — and
  // recording only the first was quietly losing that.
  const models = [];
  for (const event of events) {
    const model = event.payload && event.payload.message && event.payload.message.model;
    if (model && !models.includes(model)) {
      models.push(model);
    }
  }
  const model = models[0] || '';

  return {
    id: sessionId,
    title: routine || collapseWhitespace(prompt).slice(0, 80) || sessionId,
    routine,
    trigger_id: triggerId,
    scheduled: payload.inbound_origin === 'trigger_fire',
    // Whether the whole log was read. api.js decides this; it travels with the
    // session so every renderer can say so rather than each one guessing.
    complete: opts.complete !== false,
    truncated_reason: opts.truncatedReason || null,
    fire_reason: payload.triggerFireReason || null,
    model,
    models,
    created_at: (kickoff && kickoff.created_at) || (events[0] && events[0].created_at) || '',
    updated_at: (events[events.length - 1] && events[events.length - 1].created_at) || '',
    tool_calls: turns.reduce((n, turn) => n + turn.parts.filter(part => part.kind === 'tool_use').length, 0),
    environment_events: turns.filter(turn => turn.kind === 'environment').length,
    prompt,
    turns,
    events
  };
}

function buildTaskFrontmatter(session, opts = {}) {
  return renderFrontmatter([
    ['title', yamlScalar(session.title)],
    ['date', formatDateYYYYMMDD(session.created_at)],
    ['created', yamlScalar(session.created_at || '')],
    ['updated', yamlScalar(session.updated_at || '')],
    ['type', 'task'],
    ['status', 'reference'],
    ['frontgraph-version', FRONTGRAPH_VERSION],
    ['project', yamlScalar(opts.project || 'None')],
    ['contributor', yamlScalar(opts.contributor || '')],
    ['tags', normalizeTags(opts.tags)],
    ['source', 'claude-cowork'],
    ['source-url', yamlScalar(`https://claude.ai/cowork/${session.id}`)],
    ['routine', session.routine ? yamlScalar(session.routine) : null],
    ['trigger-id', session.trigger_id ? yamlScalar(session.trigger_id) : null],
    ['scheduled', String(session.scheduled)],
    ['complete', String(session.complete !== false)],
    ['truncated-reason', session.complete === false ? yamlScalar(session.truncated_reason || 'unknown') : null],
    ['fire-reason', session.fire_reason ? yamlScalar(session.fire_reason) : null],
    ['model', yamlScalar(session.model || '')],
    ['models', session.models && session.models.length > 1 ? session.models : null],
    ['session-id', yamlScalar(session.id)]
  ]);
}

// Everything in a turn that isn't prose, in the same blockquote and <details>
// idiom conversation attachments use. Each kind has its own switch because they
// answer different questions: tool activity is what the task did, searches are
// where its facts came from, images are what it was shown, and thinking is how
// it got there. Tool inputs go in whole, because a file-writing call carries
// the task's actual output; results and thinking fold into <details> because
// both run long.
function renderCoworkExtras(parts, opts) {
  let markdown = '';

  for (const part of parts) {
    if (part.kind === 'tool_use' && wantsToolActivity(opts)) {
      const input = JSON.stringify(part.input === undefined ? null : part.input, null, 2);
      markdown += `> **Tool:** ${part.name}\n>\n> \`\`\`json\n> ${input.replace(/\n/g, '\n> ')}\n> \`\`\`\n\n`;
    } else if (part.kind === 'tool_result' && wantsToolActivity(opts)) {
      markdown += `> <details><summary>Tool result${part.id ? ` (${part.id})` : ''}</summary>\n>\n> \`\`\`\n> ${part.text.replace(/\n/g, '\n> ')}\n> \`\`\`\n>\n> </details>\n\n`;
    } else if (part.kind === 'search_results' && wantsToolActivity(opts)) {
      const items = part.results
        .map(result => `> - ${result.url ? `[${result.title}](${result.url})` : result.title}`)
        .join('\n');
      markdown += `> **Search results**\n>\n${items}\n\n`;
    } else if (part.kind === 'image' && wantsImages(opts)) {
      markdown += part.url
        ? `![${part.media_type}](${part.url})\n\n`
        : `> **Image** (${part.media_type}) — referenced here but not saved; this extension exports text, not files.\n\n`;
    } else if (part.kind === 'unknown' && opts.includeMetadata) {
      markdown += `> **Unrecognized content block** (\`${part.type}\`) — kept in full in the ` +
        `JSON export, but this build has no way to render it.\n\n`;
    } else if (part.kind === 'thinking' && wantsThinking(opts)) {
      markdown += `> <details><summary>Thinking</summary>\n>\n> ${part.text.replace(/\n/g, '\n> ')}\n>\n> </details>\n\n`;
    }
  }

  return markdown;
}

// Tool activity is the substance of a task, not decoration on it: a run whose
// whole product was a written file has nothing else to show. So it is on unless
// asked for otherwise, and never tied to the metadata checkbox.
function wantsToolActivity(opts) {
  return opts.includeToolActivity !== false;
}

// What Claude was shown is part of the record, so image references are written
// unless asked otherwise. How it reasoned usually isn't what an archive is
// for — and it is long — so thinking is the one that has to be asked for.
function wantsImages(opts) {
  return opts.includeImages !== false;
}

function wantsThinking(opts) {
  return opts.includeThinking === true;
}

// An export that stops early says so where it cannot be missed — in the body as
// well as the frontmatter, since the body is what gets read.
function incompleteNotice(session) {
  if (session.complete !== false) return '';
  return `> **Incomplete export.** This transcript stops early because ` +
    `${session.truncated_reason || 'the event log could not be read to its end'}. ` +
    `Exporting again may produce a fuller one.\n\n`;
}

function convertTaskToMarkdown(session, includeMetadata, opts = {}) {
  let markdown = buildTaskFrontmatter(session, opts);
  markdown += `# ${session.title}\n\n`;
  markdown += incompleteNotice(session);

  if (includeMetadata) {
    if (session.routine) {
      markdown += `**Routine:** ${session.routine}\n`;
    }
    markdown += `**Fired:** ${new Date(session.created_at).toLocaleString()}\n`;
    if (session.trigger_id) {
      markdown += `**Trigger:** ${session.trigger_id}\n`;
    }
    if (session.model) {
      markdown += `**Model:** ${session.model}\n`;
    }
    markdown += `**Events:** ${session.events.length}\n`;
    markdown += `**Tool calls:** ${session.tool_calls}\n`;
    if (session.environment_events) {
      markdown += `**Environment events:** ${session.environment_events}\n`;
    }
    markdown += '\n---\n\n';
  }

  // The prompt the schedule fired is the session's first user turn, so it is
  // rendered by the loop below rather than repeated as its own section. JSON
  // exports still carry it as a discrete `prompt` field.
  //
  // A tool call and its result are separate events from the message that
  // prompted them, so turns are grouped into exchanges — a speaker's prose plus
  // the tool activity that followed it — and the separator is written once per
  // exchange. Otherwise tool blocks read as belonging to the next speaker.
  let exchange = '';

  for (const turn of session.turns) {
    // Not speech: recorded as what it is, and only when metadata is asked for.
    if (turn.kind === 'environment') {
      if (includeMetadata) {
        exchange += `> **Environment event** (${turn.event_type || 'unknown type'})\n>\n> ` +
          `${turn.text.replace(/\n/g, '\n> ')}\n\n`;
      }
      continue;
    }

    if (turn.text) {
      if (exchange) {
        markdown += `${exchange}---\n\n`;
      }
      exchange = `${turn.role === 'user' ? '**You**' : '**Claude**'}:\n\n${turn.text}\n\n`;
      if (includeMetadata && turn.created_at) {
        exchange += `*${new Date(turn.created_at).toLocaleString()}*\n\n`;
      }
    }

    // includeMetadata arrives as its own argument, so fold it in rather than
    // trusting opts to carry the same answer.
    exchange += renderCoworkExtras(turn.parts.filter(part => part.kind !== 'text'),
      { ...opts, includeMetadata });
  }

  if (exchange) {
    markdown += `${exchange}---\n\n`;
  }

  return markdown;
}

// Indent a block so it reads as belonging to the turn above it.
function indentLines(text, prefix) {
  return String(text ?? '').replace(/^/gm, prefix);
}

// Plain text for a session. A speaker label appears only where someone actually
// spoke, so a turn that was nothing but a tool call no longer renders as an
// empty line with a name on it — which is why these turns used to be dropped.
function formatCoworkPlainTurns(turns, opts) {
  const blocks = [];
  let humanSeen = false;
  let assistantSeen = false;

  for (const turn of turns) {
    if (turn.kind === 'environment') continue;

    if (turn.text) {
      let label;
      if (turn.role === 'user') {
        label = humanSeen ? 'H' : 'Human';
        humanSeen = true;
      } else {
        label = assistantSeen ? 'A' : 'Assistant';
        assistantSeen = true;
      }
      blocks.push(`${label}: ${turn.text}`);
    }

    for (const part of turn.parts) {
      if (part.kind === 'tool_use' && wantsToolActivity(opts)) {
        const input = JSON.stringify(part.input === undefined ? null : part.input, null, 2);
        blocks.push(`[tool: ${part.name}]\n${indentLines(input, '  ')}`);
      } else if (part.kind === 'tool_result' && wantsToolActivity(opts)) {
        blocks.push(`[tool result${part.id ? `: ${part.id}` : ''}]\n${indentLines(part.text, '  ')}`);
      } else if (part.kind === 'search_results' && wantsToolActivity(opts)) {
        const items = part.results
          .map(result => `- ${result.title}${result.url ? ` — ${result.url}` : ''}`)
          .join('\n');
        blocks.push(`[search results]\n${indentLines(items, '  ')}`);
      } else if (part.kind === 'image' && wantsImages(opts)) {
        blocks.push(`[image: ${part.url || `${part.media_type}, not saved`}]`);
      } else if (part.kind === 'thinking' && wantsThinking(opts)) {
        blocks.push(`[thinking]\n${indentLines(part.text, '  ')}`);
      }
    }
  }

  return blocks.join('\n\n').trim();
}

function convertTaskToText(session, includeMetadata, opts = {}) {
  let text = '';

  if (session.complete === false) {
    text += `[Incomplete export: ${session.truncated_reason || 'the event log could not be read to its end'}]\n\n`;
  }

  if (includeMetadata) {
    const tags = normalizeTags(opts.tags);
    text += `${session.title}\n`;
    if (session.routine) {
      text += `Routine: ${session.routine}\n`;
    }
    text += `Fired: ${new Date(session.created_at).toLocaleString()}\n`;
    if (session.trigger_id) {
      text += `Trigger: ${session.trigger_id}\n`;
    }
    if (tags.length) {
      text += `Tags: ${tags.join(', ')}\n`;
    }
    text += '\n---\n\n';
  }

  return text + formatCoworkPlainTurns(session.turns, opts);
}

// What a task's JSON export contains.
//
// The session object holds the raw event log and the transcript derived from
// it, which meant the same content was serialized twice and the file came out
// roughly double the size it needed to be. Only the derived form is written
// now: `turns` keeps every content block, including ones this build cannot
// render, so nothing is lost by leaving the log out — while the log's own
// field names are undocumented and have already moved once, which makes them
// the worse thing to archive. `turns[].text` is dropped too, being a
// convenience join of the text parts rather than anything new.
//
// This is a deliberate output-schema choice; frontgraph-version records it.
function taskExportJson(session, tags) {
  return {
    id: session.id,
    title: session.title,
    routine: session.routine,
    trigger_id: session.trigger_id,
    scheduled: session.scheduled,
    fire_reason: session.fire_reason,
    model: session.model,
    models: session.models,
    created_at: session.created_at,
    updated_at: session.updated_at,
    complete: session.complete !== false,
    truncated_reason: session.truncated_reason || null,
    event_count: session.events ? session.events.length : 0,
    tool_calls: session.tool_calls,
    environment_events: session.environment_events,
    prompt: session.prompt,
    tags: normalizeTags(tags),
    turns: (session.turns || []).map(turn => ({
      kind: turn.kind,
      role: turn.role,
      event_type: turn.event_type,
      created_at: turn.created_at,
      parts: turn.parts
    }))
  };
}

// The task counterpart to renderConversationExport.
async function renderTaskExport(session, format, opts = {}) {
  switch (format) {
    case 'markdown':
      return {
        content: convertTaskToMarkdown(session, opts.includeMetadata, opts),
        filename: buildDatedFilename(session.created_at, session.title, 'md'),
        alternatives: datedFilenameAlternatives(session.created_at, session.title, session.id, 'md'),
        type: 'text/markdown'
      };
    case 'text':
      return {
        content: convertTaskToText(session, opts.includeMetadata, opts),
        filename: buildDatedFilename(session.created_at, session.title, 'txt'),
        alternatives: datedFilenameAlternatives(session.created_at, session.title, session.id, 'txt'),
        type: 'text/plain'
      };
    case 'html':
      return {
        content: convertTaskToHtml(session, opts),
        filename: buildDatedFilename(session.created_at, session.title, 'html'),
        alternatives: datedFilenameAlternatives(session.created_at, session.title, session.id, 'html'),
        type: 'text/html'
      };
    // A session writes files through an event log rather than a message tree,
    // which the replay does not read yet. Falling through to JSON here would
    // hand back something that is not the format that was asked for.
    case 'provenance':
      return null;
    default:
      return {
        content: JSON.stringify(taskExportJson(session, opts.tags), null, 2),
        filename: buildDatedFilename(session.created_at, session.title, 'json'),
        alternatives: datedFilenameAlternatives(session.created_at, session.title, session.id, 'json'),
        type: 'application/json'
      };
  }
}

// Functions are available globally in the browser context
// No need for module.exports in browser extensions
