// The acceptance tests, run without a browser.
//
// The extension's scripts are loaded into one scope the way a page loads them,
// then exercised against the fixtures in ../../resc. There is no framework and
// no dependency: node test/run.js.
//
// Two of these matter more than the rest. The replay must reproduce the
// artifact a human downloaded, byte for byte, because the provenance claim
// rests on it; and message text must never reach the document as live markup,
// because these conversations are about writing HTML.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const RESC = path.join(REPO, '..', 'resc');

const SCRIPTS = [
  'vendor/markdown-it.min.js',
  'vendor/prism.min.js',
  'utils.js',
  'provenance.js',
  'html.js'
];

function loadScripts() {
  const sandbox = { console, TextEncoder, TextDecoder, URL, Date, JSON, Math, atob, btoa };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const file of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(REPO, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox;
}

function sampleConversation() {
  const raw = fs.readFileSync(path.join(RESC, 'exports/2026-09-28-mutual-agreement.json'), 'utf8');
  return JSON.parse(raw);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// A conversation that does not alternate: it opens with a reply, then runs two
// prompts and two replies together. The sample alternates cleanly and would
// pass a renderer that silently dropped messages, so this is the fixture that
// actually exercises the flat structure.
function raggedConversation() {
  const uuids = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'];
  const senders = ['assistant', 'human', 'human', 'assistant', 'assistant', 'human'];

  return {
    uuid: 'ragged',
    name: 'Ragged',
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T01:00:00Z',
    model: 'claude-opus-5-5',
    current_leaf_message_uuid: 'a5',
    chat_messages: uuids.map((uuid, index) => ({
      uuid,
      index,
      sender: senders[index],
      created_at: '2026-09-28T00:00:00Z',
      parent_message_uuid: index ? uuids[index - 1] : '00000000-0000-4000-8000-000000000000',
      content: [{ type: 'text', text: `message ${index}` }]
    }))
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// --- provenance --------------------------------------------------------

test('1. the replay reproduces the downloaded artifact byte for byte', (ctx) => {
  const [artifact] = ctx.replayArtifacts(sampleConversation());
  const rebuilt = Buffer.from(artifact.text, 'utf8');
  const downloaded = fs.readFileSync(path.join(RESC, 'artifacts/halebopp.html'));

  assert.strictEqual(rebuilt.length, 8744);
  assert.strictEqual(sha256(rebuilt), 'ce9114179255c08c2329e3ac67b474100c6b3457be8cd9cc372fbe4b9a695ce2');
  assert.ok(rebuilt.equals(downloaded), 'replay differs from the copy downloaded by hand');
  assert.strictEqual(artifact.status, 'reconstructed');
});

test('2. the published version is recorded as differing from the final one', (ctx) => {
  const [artifact] = ctx.replayArtifacts(sampleConversation());

  assert.strictEqual(artifact.published.artifact_id, '9a4fed7e-6983-4642-8214-1e16a849a46b');
  assert.strictEqual(artifact.published.url, 'https://claude.ai/artifact/L4CTd5dKifkXyefXYjZmpN');
  assert.strictEqual(artifact.published.published_bytes, 7809);
  assert.strictEqual(artifact.published.differs_from_final, true);
});

test('3. the chain names every step, in transcript order', (ctx) => {
  const [artifact] = ctx.replayArtifacts(sampleConversation());
  assert.deepStrictEqual([...artifact.chain].map(step => step.op), ['create', 'publish', 'replace', 'present']);
  assert.deepStrictEqual([...artifact.chain].map(step => step.result_bytes), [7809, 7809, 8744, 8744]);
  assert.strictEqual(artifact.chain[2].occurrences, 1);
});

test('4. a complete HTML document counts as a functional output, a fragment does not', (ctx) => {
  assert.strictEqual(ctx.isFunctionalHtml('a.html', '<!DOCTYPE html><html></html>'), true);
  assert.strictEqual(ctx.isFunctionalHtml('a.html', '<html lang="en"></html>'), true);
  assert.strictEqual(ctx.isFunctionalHtml('a.html', '<div>fragment</div>'), false);
  assert.strictEqual(ctx.isFunctionalHtml('a.txt', '<!DOCTYPE html>'), false);
  assert.strictEqual(ctx.replayArtifacts(sampleConversation())[0].functional_html, true);
});

test('5. an ambiguous edit is reported rather than silently applied', (ctx) => {
  const data = sampleConversation();
  const message = data.chat_messages.find(m => m.index === 9);
  message.content.find(c => c.type === 'tool_use' && c.name === 'str_replace').input.old_str = 'e';

  const [artifact] = ctx.replayArtifacts(data);
  assert.strictEqual(artifact.status, 'ambiguous');
  assert.ok(artifact.warnings.some(w => /matches \d+ times/.test(w)));
});

// --- the document ------------------------------------------------------

// Just the transcript: excludes the document's own trailing <script>, which
// would otherwise look like message content to a test searching for one.
function conversationOf(html) {
  const start = html.indexOf('<main class="conversation">');
  return html.slice(start, html.indexOf('</main>', start));
}

function replySummaries(html) {
  return [...conversationOf(html).matchAll(/<details class="reply"><summary>(.*?)<\/summary>/gs)].map(m => m[1]);
}

function render(ctx, data, opts) {
  const copy = JSON.parse(JSON.stringify(data));
  ctx.applyModel(copy);
  return ctx.convertToHtml(copy, Object.assign({ includeMetadata: true, includeToolActivity: true }, opts));
}

test('6. the outline is the list of prompts, in order', (ctx) => {
  const html = render(ctx, sampleConversation());
  const headings = [...html.matchAll(/<h2 class="prompt[^"]*" id="x(\d+)">/g)].map(m => Number(m[1]));

  assert.deepStrictEqual(headings, [1, 2, 3, 4, 5]);
  assert.ok(html.includes('I need you to make me an HTML artifact.'));
});

test('7. every message on the branch is rendered exactly once', (ctx) => {
  for (const data of [sampleConversation(), raggedConversation()]) {
    const html = render(ctx, data);
    const prompts = (html.match(/<h2 class="prompt/g) || []).length;
    const replies = (html.match(/<details class="reply">/g) || []).length;
    const expected = data.chat_messages.length;

    assert.strictEqual(prompts + replies, expected,
      `${data.name}: rendered ${prompts + replies} blocks for ${expected} messages`);
  }
});

test('8. a conversation opening with a reply does not lose it', (ctx) => {
  const html = render(ctx, raggedConversation());
  assert.ok(html.includes('message 0'), 'the leading assistant message vanished');
  for (let i = 0; i < 6; i++) assert.ok(html.includes(`message ${i}`), `message ${i} vanished`);
});

test('9. replies start closed and prompts are never behind a disclosure', (ctx) => {
  const html = render(ctx, sampleConversation());
  assert.ok(!/<details class="reply" open/.test(html), 'a reply rendered open');
  assert.ok(!/<details[^>]*>\s*<summary[^>]*>[^<]*<\/summary>\s*<h2 class="prompt/.test(html));
});

test('10. a reply that produced a file says so in its summary', (ctx) => {
  const html = render(ctx, sampleConversation());
  const summaries = replySummaries(html);
  const withBadge = summaries.filter(s => s.includes('halebopp.html'));

  assert.strictEqual(withBadge.length, 2, 'both messages touching the artifact should be badged');
  assert.ok(summaries.every(s => /class="excerpt"/.test(s)), 'every reply needs an excerpt');
});

// --- safety ------------------------------------------------------------

test('11. the artifact\'s own markup never becomes live markup in the document', (ctx) => {
  const body = conversationOf(render(ctx, sampleConversation()));

  assert.ok(!/<!DOCTYPE HTML PUBLIC/i.test(body), 'the sample\'s doctype rendered as a doctype');
  assert.ok(body.includes('&lt;!DOCTYPE') || !body.includes('DOCTYPE'), 'doctype should be escaped if present');
});

test('12. hostile message content renders as text', (ctx) => {
  const data = sampleConversation();
  data.chat_messages[1].content[0].text = [
    '<script>alert(1)</script>',
    '',
    '<img src=x onerror=alert(2)>',
    '',
    '[click](javascript:alert(3))',
    '',
    '<iframe src="https://example.com"></iframe>'
  ].join('\n');

  const body = conversationOf(render(ctx, data));

  assert.ok(!/<script/i.test(body), 'a script element survived');
  assert.ok(!/<img[^>]*onerror/i.test(body), 'a live event handler survived');
  assert.ok(!/href="javascript:/i.test(body), 'a javascript: href survived');
  assert.ok(!/<iframe/i.test(body), 'an iframe element survived');
  assert.ok(body.includes('&lt;script&gt;'), 'the script text should still be visible, escaped');
});

test('13. the document makes no external request', (ctx) => {
  const html = render(ctx, sampleConversation());
  const remote = html.match(/(?:src|href)\s*=\s*"(https?:)?\/\/[^"]*"/g) || [];
  const offenders = remote.filter(ref => !/claude\.ai/.test(ref));

  assert.deepStrictEqual(offenders, [], `external references: ${offenders.join(', ')}`);
  assert.ok(!/@import|fonts\.googleapis|fetch\(|XMLHttpRequest/.test(html));
});

// --- metadata ----------------------------------------------------------

test('14. the JSON-LD parses and describes a schema.org Conversation', (ctx) => {
  const html = render(ctx, sampleConversation(), { contributor: 'Paul', project: 'artifact-export-dev', tags: 'extension-dev' });
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'no JSON-LD block');

  const node = JSON.parse(match[1].replace(/\\u003c/g, '<'));
  assert.strictEqual(node['@context'], 'https://schema.org');
  assert.strictEqual(node['@type'], 'Conversation');
  assert.strictEqual(node.name, 'Mutual agreement');
  assert.strictEqual(node.creativeWorkStatus, 'reference');
  assert.strictEqual(node.schemaVersion, 'frontgraph-2');
  assert.strictEqual(node.additionalType, 'claude-conversation');
  assert.deepStrictEqual(node.keywords, ['extension-dev']);
  assert.strictEqual(node.isPartOf.name, 'artifact-export-dev');
  assert.strictEqual(node.contributor.name, 'Paul');
  assert.strictEqual(node.creator.name, 'claude-opus-5-5');
  assert.strictEqual(node.dateCreated, '2026-09-28T02:52:13.388411Z');
});

test('15. the head carries the metadata whether or not the page shows it', (ctx) => {
  const shown = render(ctx, sampleConversation(), { tags: 'extension-dev' });
  const hidden = render(ctx, sampleConversation(), { tags: 'extension-dev', includeMetadata: false });

  for (const html of [shown, hidden]) {
    assert.ok(html.includes('<meta name="keywords" content="extension-dev">'));
    assert.ok(html.includes('<meta name="generator" content="claude-opus-5-5">'));
    assert.ok(html.includes('<meta name="dcterms.created" content="2026-09-28T02:52:13.388411Z">'));
    assert.ok(html.includes('<meta name="frontgraph:model-source" content="reported">'));
  }

  assert.ok(shown.includes('class="meta-list"'), 'the visible block should be present by default');
  assert.ok(!hidden.includes('class="meta-list"'), 'includeMetadata off must hide the visible block');
});

test('16. a standalone document carries no conversation identifier', (ctx) => {
  const html = render(ctx, sampleConversation());
  const uuid = 'e4d81b26-b6c5-49aa-8cea-5a816ae5ff80';

  assert.ok(!html.includes(uuid), 'the session id reached a standalone document');
  assert.ok(!html.includes('claude.ai/chat/'), 'the source url reached a standalone document');
  assert.ok(!html.includes('organization'), 'an organization reference reached the document');
});

test('17. a bundled document keeps the identifiers, because there they are the evidence', (ctx) => {
  const html = render(ctx, sampleConversation(), { bundled: true });
  const uuid = 'e4d81b26-b6c5-49aa-8cea-5a816ae5ff80';

  assert.ok(html.includes(`<link rel="canonical" href="https://claude.ai/chat/${uuid}">`));
  const node = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));
  assert.strictEqual(node.identifier, uuid);
});

test('18. the JSON-LD agrees with the Markdown frontmatter field for field', (ctx) => {
  const opts = { contributor: 'Paul', project: 'artifact-export-dev', tags: 'extension-dev', bundled: true };
  const data = sampleConversation();
  ctx.applyModel(data);

  const frontmatter = ctx.buildFrontgraphFrontmatter(data, opts);
  const yaml = Object.fromEntries(frontmatter.split('\n')
    .filter(line => /^[a-z-]+:/.test(line))
    .map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim().replace(/^"|"$/g, '')]));

  const node = JSON.parse(ctx.convertToHtml(data, opts)
    .match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));

  assert.strictEqual(node.name, yaml.title);
  assert.strictEqual(node.dateCreated, yaml.created);
  assert.strictEqual(node.dateModified, yaml.updated);
  assert.strictEqual(node.creativeWorkStatus, yaml.status);
  assert.strictEqual(node.schemaVersion, `frontgraph-${yaml['frontgraph-version']}`);
  assert.strictEqual(node.additionalType, yaml.source);
  assert.strictEqual(node.isPartOf.name, yaml.project);
  assert.strictEqual(node.contributor.name, yaml.contributor);
  assert.strictEqual(node.creator.name, yaml.model);
  assert.strictEqual(node.identifier, yaml['session-id']);
  assert.strictEqual(node.url, yaml['source-url']);
});

// --- style -------------------------------------------------------------

test('19. no colour is defined only inside a media query, and body paints its own ground', (ctx) => {
  const style = ctx.DOCUMENT_STYLE;
  const root = style.slice(style.indexOf(':root {'), style.indexOf('}', style.indexOf(':root {')));

  const darkBlocks = [
    /:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/,
    /:root\[data-theme="dark"\]\s*\{([^}]*)\}/
  ].map(pattern => {
    const found = style.match(pattern);
    assert.ok(found, `missing theme block: ${pattern}`);
    return found[1];
  });

  for (const block of darkBlocks) {
    for (const token of [...block.matchAll(/(--[a-z-]+):/g)].map(m => m[1])) {
      assert.ok(root.includes(`${token}:`), `${token} is defined only in a dark block`);
    }
  }

  assert.ok(/body\s*\{[^}]*background:\s*var\(--ground\)/.test(style), 'body must set an explicit background');
  assert.ok(style.includes('prefers-reduced-motion'), 'reduced motion must be respected');
  assert.ok(style.includes('@media print'), 'print styles must exist');
});

test('20. code is highlighted from the declared language and never guessed at', (ctx) => {
  const data = sampleConversation();
  data.chat_messages[1].content[0].text = '```html\n<title>Hello</title>\n```\n\n```wat\nnot a language\n```';

  const html = render(ctx, data);
  assert.ok(html.includes('class="token'), 'the html block should be highlighted');
  assert.ok(html.includes('not a language'), 'an unknown language should still render');
});

// --- wiring ------------------------------------------------------------

test('21. the format dispatcher returns an HTML file for a conversation', (ctx) => {
  const data = sampleConversation();
  ctx.applyModel(data);
  const file = ctx.renderConversationExport(data, 'html', { includeMetadata: true });

  assert.strictEqual(file.type, 'text/html');
  assert.strictEqual(file.filename, '2026-09-28-mutual-agreement.html');
  assert.ok(file.content.startsWith('<!DOCTYPE html>'));
  assert.ok([...file.alternatives].every(name => name.endsWith('.html')));
});

test('22. the format dispatcher handles a Cowork session too', (ctx) => {
  const session = {
    id: 'cse_1',
    title: 'Nightly digest',
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:05:00Z',
    model: 'claude-opus-5-5',
    prompt: 'Summarise what changed today.',
    scheduled: true,
    turns: [
      { kind: 'message', role: 'user', parts: [{ kind: 'text', text: 'Summarise what changed today.' }], text: 'Summarise what changed today.', created_at: '2026-09-28T00:00:00Z' },
      { kind: 'message', role: 'assistant', parts: [{ kind: 'tool_use', name: 'bash_tool', input: { command: 'git log' } }, { kind: 'text', text: 'Three commits landed.' }], text: 'Three commits landed.', created_at: '2026-09-28T00:01:00Z' }
    ]
  };

  const file = ctx.renderTaskExport(session, 'html', { includeMetadata: true, includeToolActivity: true });
  assert.strictEqual(file.type, 'text/html');
  assert.ok(file.filename.endsWith('.html'));
  assert.ok(file.content.includes('Summarise what changed today.'));
  assert.ok(file.content.includes('Three commits landed.'));
  assert.ok(file.content.includes('bash_tool'), 'tool activity should appear');
  assert.ok(file.content.includes('scheduled run'));
});

test('23. an incomplete Cowork read is labelled in the document', (ctx) => {
  const session = {
    id: 'cse_2', title: 'Partial', created_at: '2026-09-28T00:00:00Z', updated_at: '2026-09-28T00:01:00Z',
    prompt: 'Go', turns: [], complete: false, truncated_reason: 'the event stream went quiet'
  };

  const html = ctx.renderTaskExport(session, 'html', {}).content;
  assert.ok(html.includes('Incomplete export'));
  assert.ok(html.includes('the event stream went quiet'));
});

// --- runner ------------------------------------------------------------

const ctx = loadScripts();
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn(ctx);
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message.split('\n')[0]}`);
  }
}

console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
