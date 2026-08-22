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

function formatDateYYYYMMDD(isoString) {
  const d = isoString ? new Date(isoString) : new Date(0);
  return d.toISOString().slice(0, 10);
}

// Quote a scalar for safe YAML embedding (titles/URLs may contain ": ", quotes, etc.)
function yamlScalar(value) {
  const str = String(value ?? '');
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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
// tags only hold letters, digits, _, - and /, so the only ones needing quotes
// are those a YAML parser would read as a number, date or boolean.
function yamlTagList(tags) {
  if (!tags.length) {
    return 'tags: []';
  }
  const ambiguous = /^([\d-]+|true|false|yes|no|on|off|null)$/i;
  const items = tags.map(tag => `  - ${ambiguous.test(tag) ? yamlScalar(tag) : tag}`);
  return ['tags:', ...items].join('\n');
}

// JSON exports carry the same tags the markdown frontmatter would, as an array.
function withExportTags(data, tags) {
  return { ...data, tags: normalizeTags(tags) };
}

// Emit a frontmatter block from ordered [key, value] pairs. Values arrive
// pre-formatted — wrap anything user-authored in yamlScalar first. A null
// value drops the key entirely, so exports of different source types share one
// shell without carrying each other's empty fields; the 'tags' key takes a
// tag array and expands into Obsidian's block sequence.
function renderFrontmatter(pairs) {
  const lines = ['---'];
  for (const [key, value] of pairs) {
    if (value === null || value === undefined) continue;
    lines.push(key === 'tags' ? yamlTagList(value) : `${key}: ${value}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

// Filename convention: [YYYY-MM-DD]-[slug].[ext]
function buildDatedFilename(createdAt, name, extension) {
  return `${formatDateYYYYMMDD(createdAt)}-${slugify(name)}.${extension}`;
}

function buildFrontgraphFilename(data) {
  return buildDatedFilename(data.created_at, data.name, 'md');
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
    ['project', yamlScalar(project)],
    ['contributor', opts.contributor || ''],
    ['tags', normalizeTags(opts.tags)],
    ['source', 'claude-conversation'],
    ['source_url', yamlScalar(`https://claude.ai/chat/${data.uuid || ''}`)],
    ['model', data.model || ''],
    ['session_id', data.uuid || ''],
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

// --- Cowork sessions (scheduled tasks) --------------------------------
// Tasks run as Cowork sessions (cse_… ids) rather than chat conversations, and
// are read from a replayable event log instead of a message tree. The log is
// paged: one request returns roughly 160KB of events and then closes, so a
// session is read by replaying from_sequence_num forward until no new events
// arrive (see fetchTaskPages). Everything below turns that log into the same
// turns/frontmatter shape the conversation exports use.

// Event types that carry sandbox, hook and quota bookkeeping rather than
// transcript. Anything not listed here is treated as a message-bearing event.
var COWORK_LOG_EVENT_TYPES = [
  'env_manager_log',
  'system',
  'active_goal',
  'autocompact_state',
  'rate_limit_event',
  'ping',
  'presence'
];

// Stop condition for the paging loop: high enough that no real session reaches
// it, low enough that a server ignoring from_sequence_num can't spin forever.
var COWORK_MAX_PAGES = 60;

// Parse a text/event-stream body into its data payloads. Comment frames
// (":keepalive") and non-JSON payloads are skipped; per the SSE grammar a
// single event may spread its payload over consecutive data: lines.
function parseSseEvents(body) {
  const events = [];

  for (const block of String(body ?? '').split(/\r?\n\r?\n/)) {
    let name = null;
    const dataLines = [];

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        name = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (!dataLines.length) continue;
    try {
      events.push({ event: name, data: JSON.parse(dataLines.join('\n')) });
    } catch (error) {
      // Connection-level frames aren't JSON; they carry no transcript.
    }
  }

  return events;
}

// The session's own event records, in sequence order, without the stream's
// connection bookkeeping.
function coworkEventLog(body) {
  return parseSseEvents(body)
    .filter(frame => frame.event === 'client_event' && frame.data)
    .map(frame => frame.data)
    .sort((a, b) => Number(a.sequence_num || 0) - Number(b.sequence_num || 0));
}

// How long the stream may go without delivering an event before the replay is
// treated as caught up, and a ceiling on any single page.
var COWORK_IDLE_MS = 2000;
var COWORK_PAGE_TIMEOUT_MS = 60000;

// Count delivered event frames. Comment frames (":keepalive") carry no data:
// line, so they can't be mistaken for progress and hold the read open.
function countSseDataLines(body) {
  return (body.match(/^data:/gm) || []).length;
}

// Read an event stream that has no end. This endpoint replays the backlog and
// then stays open to tail live events, so awaiting response.text() would never
// resolve once the replay runs dry — it has to be read incrementally and
// abandoned when it goes quiet. A chunk lost to the idle race is harmless: the
// next page re-requests from the last sequence number actually recorded.
async function readCoworkStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + COWORK_PAGE_TIMEOUT_MS;

  let body = '';
  let delivered = 0;
  let lastProgress = Date.now();

  try {
    for (;;) {
      const quietFor = Date.now() - lastProgress;
      const wait = Math.min(COWORK_IDLE_MS - quietFor, deadline - Date.now());
      if (wait <= 0) break;

      let timer;
      const idle = new Promise(resolve => {
        timer = setTimeout(() => resolve(null), wait);
      });

      const chunk = await Promise.race([reader.read(), idle]);
      clearTimeout(timer);

      if (!chunk || chunk.done) break;

      body += decoder.decode(chunk.value, { stream: true });

      const count = countSseDataLines(body);
      if (count > delivered) {
        delivered = count;
        lastProgress = Date.now();
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return body + decoder.decode();
}

// One page of a session's event log. The /v1/code endpoints reject an explicit
// Accept: application/json, so no Accept header is sent.
async function fetchCoworkPage(sessionId, fromSequenceNum) {
  const url = `https://claude.ai/v1/code/sessions/${sessionId}/events/stream?from_sequence_num=${fromSequenceNum}`;
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    throw new Error(`Failed to fetch task ${sessionId}: ${response.status}`);
  }

  return coworkEventLog(await readCoworkStream(response));
}

// Read a session in full. One request returns roughly 160KB of events and then
// closes, which for a task that ran tools is well short of the whole log, so
// keep replaying forward from the highest sequence number seen. Pages are
// deduplicated by event id rather than trusted to start where the last one
// stopped, and the loop gives up if a page adds nothing or fails to advance —
// so a server that ignored from_sequence_num would return one page, not spin.
async function fetchCoworkSession(sessionId) {
  const events = [];
  const seen = new Set();
  let from = 0;

  for (let page = 0; page < COWORK_MAX_PAGES; page++) {
    const batch = await fetchCoworkPage(sessionId, from);
    let added = 0;
    let highest = from;

    for (const event of batch) {
      const key = event.event_id || event.uuid || `seq:${event.sequence_num}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
      added++;
      highest = Math.max(highest, Number(event.sequence_num || 0));
    }

    console.log(`Cowork page ${page + 1}: from ${from}, +${added} events (${events.length} total)`);

    if (!added || highest <= from) break;
    from = highest;
  }

  events.sort((a, b) => Number(a.sequence_num || 0) - Number(b.sequence_num || 0));
  return summariseCoworkSession(sessionId, events);
}

// Whether a run was fired by a schedule is recorded only on the session's first
// event, so this reads one page instead of replaying the whole log — enough to
// tell a task from a session someone started by hand.
async function fetchCoworkScheduledFlag(sessionId) {
  const events = await fetchCoworkPage(sessionId, 0);
  const kickoff = events.find(event => event.event_type === 'user');
  return Boolean(kickoff && kickoff.payload && kickoff.payload.inbound_origin === 'trigger_fire');
}

// The scheduler appends its own context to the prompt it fires. That belongs in
// frontmatter, not in the transcript body.
function stripSystemReminders(text) {
  return String(text ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
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
function coworkParts(payload) {
  if (!payload) return [];

  const content = (payload.message && payload.message.content) ?? payload.content ?? payload.text;

  if (typeof content === 'string') {
    const text = stripSystemReminders(content);
    return text ? [{ kind: 'text', text }] : [];
  }
  if (!Array.isArray(content)) return [];

  const parts = [];

  for (const block of content) {
    if (typeof block === 'string') {
      const text = stripSystemReminders(block);
      if (text) parts.push({ kind: 'text', text });
      continue;
    }
    if (!block) continue;

    if (block.type === 'tool_use') {
      parts.push({ kind: 'tool_use', name: block.name || 'tool', input: block.input, id: block.id || '' });
    } else if (block.type === 'tool_result') {
      const text = coworkBlockText(block.content);
      if (text) parts.push({ kind: 'tool_result', text, id: block.tool_use_id || '' });
    } else if (block.text) {
      const text = stripSystemReminders(block.text);
      if (text) parts.push({ kind: 'text', text });
    }
  }

  return parts;
}

function coworkTurns(events) {
  const turns = [];

  for (const event of events) {
    if (COWORK_LOG_EVENT_TYPES.includes(event.event_type)) continue;

    const parts = coworkParts(event.payload);
    if (!parts.length) continue;

    const role = (event.payload && event.payload.message && event.payload.message.role) ||
      (event.event_type === 'user' ? 'user' : 'assistant');

    turns.push({
      role,
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
function summariseCoworkSession(sessionId, events) {
  const kickoff = events.find(event => event.event_type === 'user') || null;
  const payload = (kickoff && kickoff.payload) || {};
  const rawPrompt = (payload.message && payload.message.content) || '';
  const reminder = /<system-reminder>([\s\S]*?)<\/system-reminder>/.exec(rawPrompt);
  const context = reminder ? reminder[1] : '';

  const routine = (/routine\s+"([^"]+)"/.exec(context) || [])[1] || null;
  const triggerId = (/trigger_id:\s*([A-Za-z0-9_]+)/.exec(context) || [])[1] || null;
  const prompt = typeof rawPrompt === 'string' ? stripSystemReminders(rawPrompt) : '';
  const turns = coworkTurns(events);

  const firstAssistant = events.find(event => event.event_type === 'assistant');
  const model = (firstAssistant && firstAssistant.payload && firstAssistant.payload.message &&
    firstAssistant.payload.message.model) || '';

  return {
    id: sessionId,
    title: routine || collapseWhitespace(prompt).slice(0, 80) || sessionId,
    routine,
    trigger_id: triggerId,
    scheduled: payload.inbound_origin === 'trigger_fire',
    fire_reason: payload.triggerFireReason || null,
    model,
    created_at: (kickoff && kickoff.created_at) || (events[0] && events[0].created_at) || '',
    updated_at: (events[events.length - 1] && events[events.length - 1].created_at) || '',
    tool_calls: turns.reduce((n, turn) => n + turn.parts.filter(part => part.kind === 'tool_use').length, 0),
    prompt,
    turns,
    events
  };
}

// The session-list endpoint requires an API version header and rejects the
// request outright without one; the event stream above does not ask for it.
// Both are cookie-authenticated, so no API key is involved either way.
var ANTHROPIC_VERSION = '2023-06-01';

// List Cowork sessions. Errors carry the API's own explanation, which is worth
// surfacing because this endpoint's parameters are undocumented.
async function fetchCoworkList() {
  const url = 'https://claude.ai/v1/code/sessions?tags=cowork-remote&limit=100&include_trigger_sessions=true';

  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'anthropic-version': ANTHROPIC_VERSION }
  });

  if (!response.ok) {
    const detail = collapseWhitespace(await response.text()).slice(0, 300);
    throw new Error(`${response.status}${detail ? ` — ${detail}` : ''}`);
  }

  const payload = await response.json();
  const rows = normalizeCoworkList(payload);

  // This response's field names aren't documented; log one raw row so a wrong
  // guess in normalizeCoworkList is visible rather than silently blank.
  const sample = Array.isArray(payload) ? payload[0] : payload && (payload.data || payload.sessions || payload.results || [])[0];
  console.log('Cowork list: %d sessions, first raw row:', rows.length, sample);

  return rows;
}

// The session list is read for its ids; titles and timestamps here are only
// what the table shows before an export replays the log. Field names are
// tolerated in several shapes for the same reason project_name is above — this
// API has more than one spelling for the same value depending on the endpoint.
function normalizeCoworkList(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : (payload && (payload.data || payload.sessions || payload.results)) || [];

  return rows
    .map(row => ({
      id: row.id || row.session_id || row.uuid,
      title: row.title || row.name || row.summary || '(untitled session)',
      created_at: row.created_at || row.started_at || '',
      updated_at: row.updated_at || row.last_active_at || row.created_at || '',
      status: row.status || '',
      trigger_id: row.trigger_id || (row.trigger && row.trigger.id) || null
    }))
    .filter(row => row.id);
}

function buildTaskFrontmatter(session, opts = {}) {
  return renderFrontmatter([
    ['title', yamlScalar(session.title)],
    ['date', formatDateYYYYMMDD(session.created_at)],
    ['created', yamlScalar(session.created_at || '')],
    ['updated', yamlScalar(session.updated_at || '')],
    ['type', 'task'],
    ['status', 'reference'],
    ['project', yamlScalar(opts.project || 'None')],
    ['contributor', opts.contributor || ''],
    ['tags', normalizeTags(opts.tags)],
    ['source', 'claude-cowork'],
    ['source_url', yamlScalar(`https://claude.ai/cowork/${session.id}`)],
    ['routine', session.routine ? yamlScalar(session.routine) : null],
    ['trigger_id', session.trigger_id],
    ['scheduled', String(session.scheduled)],
    ['fire_reason', session.fire_reason],
    ['model', session.model || ''],
    ['session_id', session.id]
  ]);
}

// Tool activity is the provenance of a research task — which searches ran, what
// they returned, what files were written — so it is rendered rather than
// dropped, using the same blockquote/details idiom as conversation attachments.
// Tool inputs go in whole because a file-writing call carries the task's actual
// output; results are folded into a <details> block because search results run
// long.
function renderCoworkToolParts(parts) {
  let markdown = '';

  for (const part of parts) {
    if (part.kind === 'tool_use') {
      const input = JSON.stringify(part.input === undefined ? null : part.input, null, 2);
      markdown += `> **Tool:** ${part.name}\n>\n> \`\`\`json\n> ${input.replace(/\n/g, '\n> ')}\n> \`\`\`\n\n`;
    } else if (part.kind === 'tool_result') {
      markdown += `> <details><summary>Tool result${part.id ? ` (${part.id})` : ''}</summary>\n>\n> \`\`\`\n> ${part.text.replace(/\n/g, '\n> ')}\n> \`\`\`\n>\n> </details>\n\n`;
    }
  }

  return markdown;
}

function convertTaskToMarkdown(session, includeMetadata, opts = {}) {
  let markdown = buildTaskFrontmatter(session, opts);
  markdown += `# ${session.title}\n\n`;

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
    if (turn.text) {
      if (exchange) {
        markdown += `${exchange}---\n\n`;
      }
      exchange = `${turn.role === 'user' ? '**You**' : '**Claude**'}:\n\n${turn.text}\n\n`;
      if (includeMetadata && turn.created_at) {
        exchange += `*${new Date(turn.created_at).toLocaleString()}*\n\n`;
      }
    }

    if (includeMetadata) {
      exchange += renderCoworkToolParts(turn.parts.filter(part => part.kind !== 'text'));
    }
  }

  if (exchange) {
    markdown += `${exchange}---\n\n`;
  }

  return markdown;
}

function convertTaskToText(session, includeMetadata, opts = {}) {
  let text = '';

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

  // Plain text carries prose only; turns that were nothing but tool activity
  // would render as an empty speaker line.
  return text + formatPlainTurns(session.turns.filter(turn => turn.text));
}

// One place decides what a chosen export format produces, so the popup, the
// single-row export and the batch ZIP can't drift apart on filename or MIME.
function renderTaskExport(session, format, opts = {}) {
  switch (format) {
    case 'markdown':
      return {
        content: convertTaskToMarkdown(session, opts.includeMetadata, opts),
        filename: buildDatedFilename(session.created_at, session.title, 'md'),
        type: 'text/markdown'
      };
    case 'text':
      return {
        content: convertTaskToText(session, opts.includeMetadata, opts),
        filename: buildDatedFilename(session.created_at, session.title, 'txt'),
        type: 'text/plain'
      };
    default:
      return {
        content: JSON.stringify(withExportTags(session, opts.tags), null, 2),
        filename: buildDatedFilename(session.created_at, session.title, 'json'),
        type: 'application/json'
      };
  }
}

// Download file utility
function downloadFile(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Functions are available globally in the browser context
// No need for module.exports in browser extensions
