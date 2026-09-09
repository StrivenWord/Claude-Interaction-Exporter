// Every claude.ai endpoint the extension reads.
//
// Conversations live under the org-scoped /api tree and Cowork sessions under
// /v1/code. The two disagree about headers — /api wants an explicit Accept,
// /v1/code rejects one and wants an API version instead — so each request
// spells out its own rather than sharing one helper. All of them are
// authenticated GETs returning data the signed-in user can already see.
//
// Like utils.js this file is injected into claude.ai twice, by the manifest and
// again by background.js, so it must stay free of top-level const/let. It also
// loads after utils.js everywhere, and depends on it for summariseCoworkSession
// and collapseWhitespace.

var CONVERSATIONS_API = 'https://claude.ai/api/organizations';

// Errors carry the status as well as the message: the options page's connection
// test distinguishes 401 from 403 to say whether the sign-in or the
// organization ID is the problem.
async function fetchConversationsJson(url, subject) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    const error = new Error(`Failed to fetch ${subject}: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

// Titles and metadata for every conversation, without message history.
function fetchConversationList(orgId) {
  return fetchConversationsJson(`${CONVERSATIONS_API}/${orgId}/chat_conversations`, 'conversations');
}

// One conversation's full message tree, with tool blocks rendered.
function fetchConversationDetail(orgId, conversationId) {
  const url = `${CONVERSATIONS_API}/${orgId}/chat_conversations/${conversationId}` +
    '?tree=True&rendering_mode=messages&render_all_tools=true';
  return fetchConversationsJson(url, 'conversation');
}

// --- Cowork sessions (scheduled tasks) --------------------------------
// A session is read from a replayable event log rather than a message tree,
// and the log is paged: one request returns roughly 160KB of events and then
// closes, so a session is read by replaying from_sequence_num forward until no
// new events arrive. utils.js turns the resulting log into a transcript.

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
      project_name: row.project_name || (row.project && row.project.name) || null,
      trigger_id: row.trigger_id || (row.trigger && row.trigger.id) || null
    }))
    .filter(row => row.id);
}
