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

// A page of the stream ends for one of three reasons, and only one of them is
// positive evidence that the log has been read to its end.
var COWORK_END_CLOSED = 'closed';        // the server finished sending this page
var COWORK_END_IDLE = 'idle';            // it went quiet and we stopped waiting
var COWORK_END_DEADLINE = 'deadline';    // the page as a whole took too long
var COWORK_END_SATISFIED = 'satisfied';  // the caller had seen enough

// The first byte gets its own, generous allowance: the server has to find the
// session and start replaying before anything arrives, and charging that wait
// against the short inter-event budget is what used to make a cold start look
// exactly like a finished log. It ends at the first byte of any kind, not the
// first event — once the server is talking, even a keepalive, it is alive, and
// waiting the long budget out on a stream that is merely caught up would make
// every correct export slow.
var COWORK_FIRST_BYTE_MS = 15000;
var COWORK_IDLE_MS = 2000;
var COWORK_PAGE_TIMEOUT_MS = 60000;

// Retries exist for the anomalous empty page, not the ordinary last one, so
// they are gated below rather than spent on every export.
var COWORK_EMPTY_PAGE_RETRIES = 3;
var COWORK_RETRY_BACKOFF_MS = 750;

// The preview read wants only the head of a log, so it gets its own short
// ceiling. Without one, a session still streaming keeps delivering data lines,
// progress keeps being made, the idle budget never expires, and the read runs
// all the way to the page deadline — a minute, per session, behind a filter.
var COWORK_PREVIEW_TIMEOUT_MS = 8000;
var COWORK_PREVIEW_MAX_BYTES = 65536;

// Once the opening event is in hand the scheduled question is answered and only
// the model is outstanding — a bonus, not a requirement. This is how long to
// keep the connection open for it before settling for what we have.
var COWORK_PREVIEW_MODEL_GRACE_MS = 400;

// Read one page of an event stream that has no natural end. This endpoint
// replays the backlog and may then stay open to tail live events, so awaiting
// response.text() would never resolve — it has to be read incrementally. What
// matters as much as the body is why the read stopped, since the caller cannot
// otherwise tell a finished log from an abandoned one.
async function readCoworkStream(response, stopWhen, pageTimeoutMs) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + (pageTimeoutMs || COWORK_PAGE_TIMEOUT_MS);

  let body = '';
  let unterminated = '';
  let delivered = 0;
  let sawByte = false;
  let lastProgress = Date.now();
  let endedBy = COWORK_END_IDLE;

  try {
    for (;;) {
      // Until the stream says anything at all the budget is the first-byte
      // allowance; after that, the much shorter gap between events.
      const budget = sawByte ? COWORK_IDLE_MS : COWORK_FIRST_BYTE_MS;
      const wait = Math.min(budget - (Date.now() - lastProgress), deadline - Date.now());
      if (wait <= 0) {
        endedBy = Date.now() >= deadline ? COWORK_END_DEADLINE : COWORK_END_IDLE;
        break;
      }

      let timer;
      const quiet = new Promise(resolve => {
        timer = setTimeout(() => resolve(null), wait);
      });

      const chunk = await Promise.race([reader.read(), quiet]);
      clearTimeout(timer);

      if (!chunk) {
        endedBy = Date.now() >= deadline ? COWORK_END_DEADLINE : COWORK_END_IDLE;
        break;
      }
      if (chunk.done) {
        endedBy = COWORK_END_CLOSED;
        break;
      }

      const text = decoder.decode(chunk.value, { stream: true });
      body += text;

      if (!sawByte) {
        sawByte = true;
        lastProgress = Date.now();
      }

      // Count what this chunk added and carry any partial trailing line
      // forward, rather than rescanning the whole body on every chunk — that
      // cost grows with the square of the stream and eats the page deadline on
      // exactly the large sessions that most need their remaining pages.
      const before = delivered;
      unterminated += text;
      const lines = unterminated.split('\n');
      unterminated = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data:')) delivered++;
      }

      // Comment frames (":keepalive") carry no data: line, so they still can't
      // masquerade as progress and hold the read open.
      if (delivered > before) {
        lastProgress = Date.now();

        // A caller that only needs part of the log says so, rather than
        // waiting out the idle window for events it will discard.
        if (stopWhen && stopWhen(body)) {
          endedBy = COWORK_END_SATISFIED;
          break;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return { body: body + decoder.decode(), endedBy };
}

// One page of a session's event log. The /v1/code endpoints reject an explicit
// Accept: application/json, so no Accept header is sent.
async function fetchCoworkPage(sessionId, fromSequenceNum, stopWhen, pageTimeoutMs) {
  const url = `https://claude.ai/v1/code/sessions/${sessionId}/events/stream?from_sequence_num=${fromSequenceNum}`;
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    throw new Error(`Failed to fetch task ${sessionId}: ${response.status}`);
  }

  const { body, endedBy } = await readCoworkStream(response, stopWhen, pageTimeoutMs);
  return { events: coworkEventLog(body), endedBy };
}

// A fingerprint for one event, used to skip any event already collected.
//
// The id fields here are undocumented, so the fallbacks matter: an event with
// none of them is fingerprinted by where it was — which request delivered it,
// and its position in that request — rather than by a constant. That is the
// whole point. Keying every id-less event the same way, as `seq:${undefined}`
// once did, made them all look like one event: the first was kept and the rest
// of the log was silently discarded. Position can't collapse that way, and is
// stable when a page is re-read, so genuine duplicates are still caught.
//
// Each form is prefixed so the namespaces can't overlap, and presence is tested
// rather than truthiness, so an id of 0 or "" isn't mistaken for a missing one.
function coworkEventKey(event, from, index) {
  if (event.event_id !== undefined && event.event_id !== null && event.event_id !== '') {
    return `id:${event.event_id}`;
  }
  if (event.uuid !== undefined && event.uuid !== null && event.uuid !== '') {
    return `uuid:${event.uuid}`;
  }
  if (event.sequence_num !== undefined && event.sequence_num !== null) {
    return `seq:${event.sequence_num}`;
  }
  return `pos:${from}:${index}`;
}

// Read a session in full, and say so honestly when that wasn't possible.
//
// The hard part is not the paging, it is knowing when to stop. Silence is not
// evidence: a server that hasn't started replaying yet and a log that has run
// out look identical from here, and treating the first as the second is how an
// export used to come out empty while reporting success. So an empty page is
// only accepted as the end when the server closed the stream itself — and when
// this endpoint never closes a page at all, which it is entitled to do since it
// tails live events, that is worked out from its own observed behaviour rather
// than assumed either way.
async function fetchCoworkSession(sessionId) {
  const events = [];
  const seen = new Set();
  let from = 0;
  let pages = 0;
  let sawClose = false;
  let complete = false;
  let reason = null;

  while (pages < COWORK_MAX_PAGES) {
    let batch = null;

    for (let attempt = 0; attempt <= COWORK_EMPTY_PAGE_RETRIES; attempt++) {
      pages++;
      batch = await fetchCoworkPage(sessionId, from);
      if (batch.endedBy === COWORK_END_CLOSED) sawClose = true;
      if (batch.events.length || batch.endedBy === COWORK_END_CLOSED) break;

      // An empty page that never closed is worth asking about again only when
      // it is genuinely anomalous: either this endpoint has closed pages
      // before, so silence is out of character, or nothing has arrived at all
      // and there is no export to lose by trying once more. On an endpoint
      // that only ever tails, the last page is always an empty one — retrying
      // that would put seconds of dead waiting into every correct export.
      const worthRetrying = sawClose || !events.length;
      if (!worthRetrying || attempt === COWORK_EMPTY_PAGE_RETRIES) break;

      await new Promise(resolve => setTimeout(resolve, COWORK_RETRY_BACKOFF_MS * (attempt + 1)));
    }

    let added = 0;
    let highest = from;

    batch.events.forEach((event, index) => {
      const key = coworkEventKey(event, from, index);
      if (seen.has(key)) return;
      seen.add(key);
      events.push(event);
      added++;
      highest = Math.max(highest, Number(event.sequence_num || 0));
    });

    console.log(`Cowork page ${pages}: from ${from}, +${added} events (${events.length} total, ended by ${batch.endedBy})`);

    if (!added) {
      if (batch.endedBy === COWORK_END_CLOSED) {
        // The server ended the page with nothing beyond what we hold.
        complete = true;
      } else if (batch.endedBy === COWORK_END_IDLE && !sawClose) {
        // This endpoint has never once closed a page for us, so going quiet is
        // the only end-of-log signal it gives, and repeated silence is what
        // that looks like. Accepting it here is what keeps a correct export
        // from carrying a warning every single time.
        complete = true;
      } else {
        reason = `the event stream went quiet with more of the log still expected (${batch.endedBy})`;
      }
      break;
    }

    if (highest <= from) {
      // Events arrived but the sequence number never advanced, so asking again
      // would fetch the same place forever.
      reason = 'the event stream stopped advancing its sequence numbers';
      break;
    }

    from = highest;
  }

  if (!complete && !reason) {
    reason = `the log was still going after ${pages} pages`;
  }

  // An empty read is never written out. A file naming the session, dated
  // 1970-01-01 and holding no transcript, is worse than a failure: it looks
  // like a real export of an empty session.
  if (!events.length) {
    throw new Error(
      `No events came back for ${sessionId}${reason ? ` — ${reason}` : ''}. Nothing was written. ` +
      `Try again, or open the session in Claude.ai to confirm it still exists.`);
  }

  events.sort((a, b) => Number(a.sequence_num || 0) - Number(b.sequence_num || 0));
  return summariseCoworkSession(sessionId, events, { complete, truncatedReason: reason });
}

// The two things about a session that the list endpoint doesn't tell us, and
// that both sit at the very start of its log: whether a schedule fired it,
// recorded on the first user event, and which model answered, recorded on the
// first assistant event. Reading them together costs the same one request as
// reading either alone.
//
// The read stops as soon as both have arrived rather than buffering a whole
// page and waiting out the idle window — this runs once per session behind the
// browse page's filters, where that wait was the whole of the delay.
async function fetchCoworkPreview(sessionId) {
  const eventModel = event => event.payload && event.payload.message && event.payload.message.model;

  let openingSeenAt = 0;

  const { events } = await fetchCoworkPage(sessionId, 0, body => {
    // Probing re-parses the body it is handed, so cap how much of one is ever
    // probed regardless of what arrives.
    if (body.length > COWORK_PREVIEW_MAX_BYTES) return true;

    const log = coworkEventLog(body);
    if (!log.some(event => event.event_type === 'user')) return false;
    if (!openingSeenAt) openingSeenAt = Date.now();

    // The model sits on the first assistant message where it is recorded at
    // all, so that event settles it either way.
    if (log.some(event => event.event_type === 'assistant' || eventModel(event))) return true;

    // Otherwise the scheduled answer is already in hand. A session that keeps
    // streaming would hold this open indefinitely waiting for a model it may
    // never record, so give up on the bonus and take what we have.
    return Date.now() - openingSeenAt > COWORK_PREVIEW_MODEL_GRACE_MS;
  }, COWORK_PREVIEW_TIMEOUT_MS);

  const kickoff = events.find(event => event.event_type === 'user');
  const answered = events.find(eventModel);

  // No opening event means the question wasn't answered, which is not the same
  // as answering "no". Reporting false here would let the scheduled filter hide
  // a session on the strength of a read that failed.
  if (!kickoff) {
    throw new Error(`Could not read the start of session ${sessionId}`);
  }

  return {
    scheduled: kickoff.payload && kickoff.payload.inbound_origin === 'trigger_fire',
    model: (answered && eventModel(answered)) || ''
  };
}

// The session-list endpoint requires an API version header and rejects the
// request outright without one; the event stream above does not ask for it.
// Both are cookie-authenticated, so no API key is involved either way.
var ANTHROPIC_VERSION = '2023-06-01';

// The list is fetched in pages. A ceiling on how many, so an endpoint that
// ignores the paging parameters can't loop: it would return the same rows,
// which are deduplicated by id and so add nothing, ending the loop anyway.
var COWORK_LIST_PAGE_SIZE = 100;
var COWORK_LIST_MAX_PAGES = 10;

// Only sessions tagged cowork-remote are listed. That is the tag the web app's
// own sessions carry; anything Cowork stores under another tag would not appear
// here, which is worth knowing but not worth guessing about — the parameters on
// this endpoint are undocumented, and widening the query blind could return an
// unrelated set rather than more of the right one.
function coworkListUrl({ cursor, offset }) {
  const params = new URLSearchParams({
    tags: 'cowork-remote',
    limit: String(COWORK_LIST_PAGE_SIZE),
    include_trigger_sessions: 'true'
  });
  if (cursor) params.set('cursor', cursor);
  else if (offset) params.set('offset', String(offset));
  return `https://claude.ai/v1/code/sessions?${params}`;
}

// A continuation token, under whichever of several plausible names this
// endpoint uses. Absent from every response shape means cursor paging isn't
// offered, and the caller falls back to an offset.
function coworkListCursor(payload) {
  if (!payload || Array.isArray(payload)) return null;
  return payload.next_cursor || payload.next_page_token || payload.cursor ||
    (payload.pagination && (payload.pagination.next_cursor || payload.pagination.next)) || null;
}

async function fetchCoworkListPage(options) {
  const response = await fetch(coworkListUrl(options), {
    credentials: 'include',
    headers: { 'anthropic-version': ANTHROPIC_VERSION }
  });

  if (!response.ok) {
    const detail = collapseWhitespace(await response.text()).slice(0, 300);
    throw new Error(`${response.status}${detail ? ` — ${detail}` : ''}`);
  }

  const payload = await response.json();
  return { payload, rows: normalizeCoworkList(payload) };
}

// List Cowork sessions, following the list past its page size rather than
// stopping at the first hundred and saying nothing. Errors carry the API's own
// explanation, which is worth surfacing because this endpoint's parameters are
// undocumented — as is `truncated`, which says the listing may be short so the
// browse page can admit that rather than presenting it as everything.
async function fetchCoworkList() {
  const rows = [];
  const seen = new Set();
  let cursor = null;
  let offset = 0;
  let truncated = false;
  let sample = null;

  for (let page = 0; page < COWORK_LIST_MAX_PAGES; page++) {
    const { payload, rows: batch } = await fetchCoworkListPage({ cursor, offset });

    if (!sample) {
      // This response's field names aren't documented; keep one raw row so a
      // wrong guess in normalizeCoworkList is visible rather than silently blank.
      sample = Array.isArray(payload)
        ? payload[0]
        : payload && (payload.data || payload.sessions || payload.results || [])[0];
    }

    let added = 0;
    for (const row of batch) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
      added++;
    }

    console.log(`Cowork list page ${page + 1}: ${batch.length} rows, +${added} new (${rows.length} total)`);

    cursor = coworkListCursor(payload);
    if (cursor) continue;

    // No continuation token. A short page is the end of the list; a full one
    // means there may be more, so try an offset — an endpoint that ignores it
    // returns the same rows, which add nothing and end the loop here.
    if (!added || batch.length < COWORK_LIST_PAGE_SIZE) break;

    offset += COWORK_LIST_PAGE_SIZE;

    if (page === COWORK_LIST_MAX_PAGES - 1) {
      truncated = true;
    }
  }

  console.log('Cowork list: %d sessions%s, first raw row:', rows.length, truncated ? ' (truncated)' : '', sample);

  return { rows, truncated };
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
