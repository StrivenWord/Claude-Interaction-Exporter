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
  'jszip.min.js',
  'vendor/markdown-it.min.js',
  'vendor/prism-manual.js',
  'vendor/prism.min.js',
  'utils.js',
  'provenance.js',
  'html.js',
  'bundle.js',
  'deliver.js'
];

// Enough of an extension page for the renderers to run in: the browser globals
// they use, and the two chrome APIs the bundle reaches for.
function loadScripts() {
  const sandbox = {
    console, TextEncoder, TextDecoder, URL, Date, JSON, Math, atob, btoa,
    Blob, setTimeout, clearTimeout, Promise, crypto: require('crypto').webcrypto,
    chrome: {
      runtime: {
        getManifest: () => JSON.parse(fs.readFileSync(path.join(REPO, 'manifest.json'), 'utf8')),
        getURL: (name) => `extension://${name}`
      }
    },
    fetch: async (url) => ({
      text: async () => fs.readFileSync(path.join(REPO, String(url).replace('extension://', '')), 'utf8')
    })
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const file of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(REPO, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox;
}

// The capture a provenance export works from: the response bytes as received,
// before applyModel or the export UI's tags touch anything.
function sampleCapture() {
  const text = fs.readFileSync(path.join(RESC, 'exports/2026-09-28-mutual-agreement.json'), 'utf8');
  return {
    text,
    data: JSON.parse(text),
    url: 'https://claude.ai/api/organizations/ORG/chat_conversations/e4d81b26?tree=True',
    fetched_at: '2026-09-28T10:09:08.697Z'
  };
}

async function buildBundle(ctx, opts) {
  const capture = sampleCapture();
  ctx.applyModel(capture.data);
  const file = await ctx.renderProvenanceBundle(capture.data, capture,
    Object.assign({ includeMetadata: true, includeToolActivity: true, orgId: 'ORG' }, opts));

  // A typed array crosses realms badly — JSZip checks it against the sandbox's
  // own Uint8Array — but a base64 string is a primitive and does not.
  const buffer = Buffer.from(await file.content.arrayBuffer());
  const zip = await ctx.JSZip.loadAsync(buffer.toString('base64'), { base64: true });
  const entries = {};
  for (const name of Object.keys(zip.files)) {
    // Same realm problem in reverse: JSZip in the sandbox cannot see node's
    // Buffer, so it hands back base64 and the host side rebuilds the bytes.
    if (!zip.files[name].dir) entries[name] = Buffer.from(await zip.files[name].async('base64'), 'base64');
  }
  return { file, entries, manifest: JSON.parse(entries['manifest.json'].toString('utf8')) };
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

test('10a. an attached file is named in the document, as Markdown names it', (ctx) => {
  const data = sampleConversation();
  data.chat_messages[0].attachments = [{
    file_name: 'syllabus.pdf', file_size: 20480, file_type: 'application/pdf',
    extracted_content: 'Week 1: introductions'
  }];

  const html = render(ctx, data);
  assert.ok(html.includes('syllabus.pdf'), 'the attachment vanished from the HTML export');
  assert.ok(html.includes('20.0 KB'));
  assert.ok(html.includes('Week 1: introductions'), 'extracted text should be kept, behind a disclosure');

  // Whatever Markdown carries, the document has to carry too.
  const markdown = ctx.convertToMarkdown(data, true, {});
  assert.ok(markdown.includes('syllabus.pdf'));
});

test('10b. a conversation with no attachments gains no empty block', (ctx) => {
  const html = render(ctx, sampleConversation());
  assert.ok(!html.includes('class="attachments"'));
  assert.ok(!html.includes('>Attached<'));
});

test('6a. a conversation with no messages says so rather than rendering a blank page', (ctx) => {
  const data = sampleConversation();
  data.chat_messages = [];
  const html = render(ctx, data);

  assert.ok(html.includes('Nothing to show'), 'an empty conversation rendered silently');
  assert.ok(html.includes('The export succeeded'));
  assert.ok(!html.includes('id="expand-all"'), 'no controls when there is nothing to expand');
});

test('6b. a scheduled run with no typed prompt still gets a heading', async (ctx) => {
  const session = {
    id: 'cse_3', title: 'Nightly digest', created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:05:00Z', prompt: '', scheduled: true,
    turns: [{ kind: 'message', role: 'assistant', parts: [{ kind: 'text', text: 'Done.' }], text: 'Done.', created_at: '2026-09-28T00:01:00Z' }]
  };

  const html = (await ctx.renderTaskExport(session, 'html', { includeMetadata: true })).content;
  assert.ok(/<h2 class="prompt[^"]*" id="x1">/.test(html), 'the document has no heading at all');
  assert.ok(html.includes('Nightly digest'));
  assert.ok(html.includes('Done.'));
});

test('6c. the vendored highlighter covers the languages these conversations use', (ctx) => {
  // Chosen from the 96-document export rather than guessed: bash and yaml
  // dominate, and this is a Jekyll and Ruby workspace.
  for (const language of ['bash', 'yaml', 'ruby', 'liquid', 'markdown', 'json', 'javascript', 'python', 'markup', 'css', 'typescript']) {
    assert.ok(ctx.Prism.languages[language], `Prism has no grammar for ${language}`);
  }
  assert.ok(/class="token /.test(ctx.Prism.highlight('a: 1', ctx.Prism.languages.yaml, 'yaml')));
  assert.ok(/class="token /.test(ctx.Prism.highlight('def x; end', ctx.Prism.languages.ruby, 'ruby')));
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

test('21. the format dispatcher returns an HTML file for a conversation', async (ctx) => {
  const data = sampleConversation();
  ctx.applyModel(data);
  const file = await ctx.renderConversationExport(data, 'html', { includeMetadata: true });

  assert.strictEqual(file.type, 'text/html');
  assert.strictEqual(file.filename, '2026-09-28-mutual-agreement.html');
  assert.ok(file.content.startsWith('<!DOCTYPE html>'));
  assert.ok([...file.alternatives].every(name => name.endsWith('.html')));
});

test('22. the format dispatcher handles a Cowork session too', async (ctx) => {
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

  const file = await ctx.renderTaskExport(session, 'html', { includeMetadata: true, includeToolActivity: true });
  assert.strictEqual(file.type, 'text/html');
  assert.ok(file.filename.endsWith('.html'));
  assert.ok(file.content.includes('Summarise what changed today.'));
  assert.ok(file.content.includes('Three commits landed.'));
  assert.ok(file.content.includes('bash_tool'), 'tool activity should appear');
  assert.ok(file.content.includes('scheduled run'));
});

test('23. an incomplete Cowork read is labelled in the document', async (ctx) => {
  const session = {
    id: 'cse_2', title: 'Partial', created_at: '2026-09-28T00:00:00Z', updated_at: '2026-09-28T00:01:00Z',
    prompt: 'Go', turns: [], complete: false, truncated_reason: 'the event stream went quiet'
  };

  const html = (await ctx.renderTaskExport(session, 'html', {})).content;
  assert.ok(html.includes('Incomplete export'));
  assert.ok(html.includes('the event stream went quiet'));
});

// --- the bundle --------------------------------------------------------

test('24. the bundle holds the document, the transcripts, the artifact and the verifier', async (ctx) => {
  const { entries } = await buildBundle(ctx);
  const names = Object.keys(entries).sort();

  for (const expected of [
    'README.md', 'conversation.html', 'manifest.json', 'verify.html',
    'artifact/halebopp.html',
    'transcript/conversation.json', 'transcript/conversation.md', 'transcript/conversation.txt'
  ]) {
    assert.ok(names.includes(expected), `${expected} missing from the bundle (has ${names.join(', ')})`);
  }
});

test('25. the transcript in the bundle is the response as received, unmodified', async (ctx) => {
  const { entries, manifest } = await buildBundle(ctx, { tags: 'extension-dev', contributor: 'Paul' });
  const shipped = entries['transcript/conversation.json'];
  const original = fs.readFileSync(path.join(RESC, 'exports/2026-09-28-mutual-agreement.json'));

  assert.ok(shipped.equals(original), 'the shipped transcript is not the bytes that arrived');
  assert.strictEqual(manifest.capture.response_sha256, sha256(original));
  assert.strictEqual(manifest.capture.response_bytes, original.length);
  assert.strictEqual(manifest.annotations.contributor, 'Paul');
  assert.deepStrictEqual([...manifest.annotations.tags], ['extension-dev']);
});

test('25a. the exporter\'s inferences stay out of the evidence file', async (ctx) => {
  // A conversation the API returned with no model: applyModel will guess one
  // from the creation date and stamp model_source onto the object it renders
  // from. None of that may reach the bytes offered as evidence.
  const original = fs.readFileSync(path.join(RESC, 'exports/2026-09-28-mutual-agreement.json'), 'utf8');
  const text = original.replace('"model": "claude-opus-5-5"', '"model": null');
  const capture = { text, data: JSON.parse(text), url: 'https://claude.ai/api/…', fetched_at: '2026-09-28T10:09:08.697Z' };

  ctx.applyModel(capture.data);
  assert.strictEqual(capture.data.model_source, 'inferred', 'the fixture should force an inference');

  const file = await ctx.renderProvenanceBundle(capture.data, capture, { orgId: 'ORG' });
  const zip = await ctx.JSZip.loadAsync(Buffer.from(await file.content.arrayBuffer()).toString('base64'), { base64: true });
  const shipped = Buffer.from(await zip.files['transcript/conversation.json'].async('base64'), 'base64').toString('utf8');
  const manifest = JSON.parse(Buffer.from(await zip.files['manifest.json'].async('base64'), 'base64').toString('utf8'));

  assert.strictEqual(shipped, text, 'the evidence file was rewritten');
  assert.strictEqual(JSON.parse(shipped).model, null, 'an inferred model reached the evidence file');
  assert.strictEqual(manifest.source.model_source, 'inferred', 'the manifest should say the model was inferred');
  assert.ok(manifest.source.model, 'the manifest should still name the inferred model');
});

test('26. the artifact in the bundle is the file the conversation produced', async (ctx) => {
  const { entries, manifest } = await buildBundle(ctx);
  const shipped = entries['artifact/halebopp.html'];
  const downloaded = fs.readFileSync(path.join(RESC, 'artifacts/halebopp.html'));

  assert.ok(shipped.equals(downloaded), 'the bundled artifact differs from the downloaded copy');
  assert.strictEqual(manifest.artifacts[0].sha256, sha256(downloaded));
  assert.strictEqual(manifest.assurance.derivation, 'proven');
});

test('27. the version published before later edits is kept separately', async (ctx) => {
  const { entries, manifest } = await buildBundle(ctx);
  const published = entries['artifact/versions/halebopp.published.html'];

  assert.ok(published, 'the published version was not written');
  assert.strictEqual(published.length, 7809);
  assert.strictEqual(manifest.artifacts[0].published.differs_from_final, true);
});

test('28. every step of the chain carries its own hash', async (ctx) => {
  const { manifest, entries } = await buildBundle(ctx);
  const chain = manifest.artifacts[0].chain;

  assert.strictEqual(chain.length, 4);
  for (const step of chain) {
    assert.match(step.result_sha256, /^[0-9a-f]{64}$/, `step ${step.step} has no hash`);
    assert.strictEqual(step.result_text, undefined, 'the chain should point at the transcript, not copy it');
  }
  assert.strictEqual(chain[3].result_sha256, sha256(entries['artifact/halebopp.html']));
  assert.strictEqual(chain[1].result_sha256, sha256(entries['artifact/versions/halebopp.published.html']));
});

test('29. every file in the bundle is listed with a hash that matches it', async (ctx) => {
  const { entries, manifest } = await buildBundle(ctx);

  for (const entry of manifest.files) {
    assert.ok(entries[entry.path], `${entry.path} is listed but not present`);
    assert.strictEqual(sha256(entries[entry.path]), entry.sha256, `${entry.path} hash mismatch`);
  }

  // The verifier and the readme are the instrument and the explanation, not
  // evidence, so they are deliberately not vouched for by the record.
  const listed = manifest.files.map(f => f.path);
  assert.ok(!listed.includes('verify.html'));
  assert.ok(!listed.includes('manifest.json'));
});

test('30. the bundled document keeps the identifiers and links the artifact as a sibling', async (ctx) => {
  const { entries } = await buildBundle(ctx);
  const html = entries['conversation.html'].toString('utf8');

  assert.ok(html.includes('href="artifact/halebopp.html"'), 'the artifact should be linked relatively');
  assert.ok(html.includes('e4d81b26-b6c5-49aa-8cea-5a816ae5ff80'), 'a bundled document keeps the session id');
});

test('31. the readme says what is proven and what is not', async (ctx) => {
  const { entries } = await buildBundle(ctx);
  const readme = entries['README.md'].toString('utf8');

  assert.ok(readme.includes('It does not prove the conversation happened'));
  assert.ok(readme.includes('Anthropic does not sign'));
  assert.ok(readme.includes('reproduced exactly from the transcript'));
});

test('32. the bundle is delivered as a stored entry inside a batch archive', async (ctx) => {
  const { file } = await buildBundle(ctx);
  assert.strictEqual(file.type, 'application/zip');
  assert.strictEqual(file.compression, 'STORE');
  assert.match(file.filename, /^2026-09-28-mutual-agreement-provenance\.zip$/);
});

test('37. Prism never highlights the page it is loaded into', (ctx) => {
  // Injected into claude.ai, an auto-running Prism would rewrite code blocks in
  // the conversation on screen. It is only ever called directly, so the page
  // sweep has to be off before the library initialises.
  assert.strictEqual(ctx.Prism.manual, true, 'Prism would highlight the host page');
  assert.strictEqual(ctx.Prism.disableWorkerMessageHandler, true);
});

test('38. a conversation that produced nothing yields no bundle', async (ctx) => {
  const capture = sampleCapture();
  // Strip the tool calls: a real conversation that only talked.
  for (const message of capture.data.chat_messages) {
    message.content = (message.content || []).filter(block => block.type === 'text');
  }
  capture.text = JSON.stringify(capture.data);
  ctx.applyModel(capture.data);

  const file = await ctx.renderProvenanceBundle(capture.data, capture, { orgId: 'ORG' });
  assert.strictEqual(file, null, 'an archive with nothing to verify still looks like evidence');
});

test('39. a Cowork session is skipped rather than handed back as JSON', async (ctx) => {
  const session = {
    id: 'cse_4', title: 'Nightly digest', created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:05:00Z', prompt: 'Go', turns: []
  };

  // The trap: `default:` in the dispatcher returns JSON, so an unhandled format
  // silently produces a file that is not the one that was asked for.
  assert.strictEqual(await ctx.renderTaskExport(session, 'provenance', {}), null);
  assert.strictEqual((await ctx.renderTaskExport(session, 'json', {})).type, 'application/json');
  assert.strictEqual((await ctx.renderTaskExport(session, 'html', {})).type, 'text/html');
});

test('40. a batch counts a skipped row rather than losing it', async (ctx) => {
  const kept = [];
  const result = await ctx.runBatch({
    items: [{ id: 'a', name: 'Has a file' }, { id: 'b', name: 'Produced nothing' }],
    noun: 'interactions',
    renderItem: async (item) => item.id === 'a'
      ? { filename: 'a.zip', content: 'x', type: 'application/zip' }
      : null,
    destination: { async begin() {}, async put(file) { kept.push(file.filename); }, async finish() {} }
  });

  assert.strictEqual(result.completed, 1);
  assert.strictEqual(result.skipped, 1);
  assert.strictEqual(result.failed, 0);
  assert.deepStrictEqual(kept, ['a.zip']);
  assert.match(ctx.describeBatch(result, 'interactions'), /1 left out/);
});

// --- the verifier ------------------------------------------------------

// verify.html carries its own copy of the replay, because it has to work in a
// folder with nothing installed — and because a verifier that imported its
// logic from the thing it checks would be checking nothing. The two
// implementations agreeing is the property that matters, so it is asserted
// rather than assumed.
function loadVerifier() {
  const source = fs.readFileSync(path.join(REPO, 'verify.html'), 'utf8');
  const script = source.slice(source.lastIndexOf('<script>') + 8, source.lastIndexOf('</script>'));

  const element = { addEventListener() {}, classList: { add() {}, remove() {} }, files: [], innerHTML: '' };
  const sandbox = {
    console, TextEncoder, TextDecoder, Date, JSON, Math, Uint8Array, Int32Array, DataView,
    crypto: require('crypto').webcrypto,
    document: { getElementById: () => element, querySelectorAll: () => [] }
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'verify.html' });
  return sandbox;
}

test('33. the verifier reproduces the artifact independently of the exporter', async (ctx) => {
  const { entries, manifest } = await buildBundle(ctx);
  const verifier = loadVerifier();

  const conversation = JSON.parse(entries['transcript/conversation.json'].toString('utf8'));
  const files = verifier.replay(conversation);
  const artifact = manifest.artifacts[0];
  const rebuilt = files.get(artifact.source_path);

  assert.ok(rebuilt, 'the verifier found no artifact in the transcript');
  assert.strictEqual(rebuilt.text, entries['artifact/halebopp.html'].toString('utf8'));
  assert.strictEqual(await verifier.sha256(new TextEncoder().encode(rebuilt.text)), artifact.sha256);
});

test('34. the verifier\'s hashing agrees with the exporter\'s, with and without WebCrypto', async (ctx) => {
  const verifier = loadVerifier();
  const bytes = new TextEncoder().encode('the quick brown fox');
  const expected = crypto.createHash('sha256').update('the quick brown fox').digest('hex');

  assert.strictEqual(await verifier.sha256(bytes), expected);
  // The fallback exists so a browser without crypto.subtle on file:// cannot be
  // the reason a verification fails. It has to give the same answer.
  assert.strictEqual(verifier.sha256Fallback(bytes), expected);
});

test('35. a tampered artifact is caught, and the step that diverges is identifiable', async (ctx) => {
  const { entries, manifest } = await buildBundle(ctx);
  const verifier = loadVerifier();

  const tampered = entries['artifact/halebopp.html'].toString('utf8').replace('Hale-Bopp', 'Hale-Bapp');
  const digest = await verifier.sha256(new TextEncoder().encode(tampered));

  assert.notStrictEqual(digest, manifest.artifacts[0].sha256);
  assert.ok(!manifest.artifacts[0].chain.some(step => step.result_sha256 === digest),
    'a tampered file must not match any version in the chain');
});

test('36. a copy taken before the last edits is recognised as an earlier version', async (ctx) => {
  const { entries, manifest } = await buildBundle(ctx);
  const verifier = loadVerifier();

  // Exactly the case the sample presents: the artifact was published, then
  // edited twice. Someone holding the published copy has a real version of this
  // file, and saying "not yours" would be wrong.
  const published = entries['artifact/versions/halebopp.published.html'];
  const digest = await verifier.sha256(new Uint8Array(published));
  const chain = manifest.artifacts[0].chain;
  const matches = chain.filter(s => s.result_sha256 === digest);

  assert.ok(matches.length, 'the published version was not recognised anywhere in the chain');
  assert.notStrictEqual(digest, manifest.artifacts[0].sha256);

  // Publishing does not change a file, so create and publish share their bytes.
  // The verifier reports the latest step with those bytes, which is the one
  // that tells the reader their copy is the published version.
  assert.strictEqual(matches[matches.length - 1].op, 'publish');
});

// --- runner ------------------------------------------------------------

(async () => {
  const ctx = loadScripts();
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn(ctx);
      console.log(`  ok   ${name}`);
    } catch (error) {
      failed++;
      console.log(`  FAIL ${name}`);
      console.log(`       ${error.message.split('\n')[0]}`);
    }
  }

  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
