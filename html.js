// A conversation as a document meant to be published.
//
// The other renderers produce a transcript; this one produces a page — set for
// reading, carrying the same metadata the Markdown export carries, linking the
// files the conversation produced, and self-contained enough to open from a
// disk with the network off. Nothing it emits reaches outside itself: no fonts,
// no CDN, no requests.
//
// The document is prompt-led but flat. Every message renders in branch order;
// the person's turns lead and stay open, Claude's are subordinated beneath them
// and closed. That relationship is carried by spacing, a shared exchange number
// and the heading structure rather than by nesting, so no pairing step exists
// to lose a message when a conversation does not alternate.
//
// Like utils.js this file is injected into claude.ai twice, so it must stay
// free of top-level const/let. It loads after utils.js and provenance.js, and
// needs markdown-it and Prism, which the service worker injects on demand.

var HTML_EXPORT_VERSION = 1;

// --- style -------------------------------------------------------------
// Neutrals are biased toward the extension's own navy rather than defaulted to
// grey, and every colour is a token defined on bare :root so the dark block
// only ever redefines values. Three faces carry three strata: serif for what
// was said, sans for apparatus, mono for the technical layer.

var DOCUMENT_STYLE = `
:root {
  --ground: #FBFCFD;
  --surface: #F2F5F9;
  --raised: #EAEFF6;
  --ink: #11161F;
  --muted: #5C6980;
  --rule: #DDE3EC;
  --accent: #1E376C;
  --accent-ink: #16294F;
  --ok: #1D6B4F;
  --warn: #8A5A0B;
  --hl-key: #1E376C;
  --hl-str: #2C6A4A;
  --hl-attr: #7A4E17;
  --hl-num: #8A3A5E;

  --serif: ui-serif, Charter, "Bitstream Charter", "Iowan Old Style", Georgia, serif;
  --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, "Cascadia Code", Menlo, Consolas, monospace;

  --measure: 34rem;
  --spine: 3rem;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0E131B;
    --surface: #161D28;
    --raised: #1E2836;
    --ink: #E8EDF4;
    --muted: #8C99AE;
    --rule: #242E3D;
    --accent: #7FA8DC;
    --accent-ink: #A8C6E8;
    --ok: #5FBF96;
    --warn: #E0A94A;
    --hl-key: #9BBFE8;
    --hl-str: #7FC9A3;
    --hl-attr: #D9B27C;
    --hl-num: #E0A0BE;
  }
}

:root[data-theme="dark"] {
  --ground: #0E131B;
  --surface: #161D28;
  --raised: #1E2836;
  --ink: #E8EDF4;
  --muted: #8C99AE;
  --rule: #242E3D;
  --accent: #7FA8DC;
  --accent-ink: #A8C6E8;
  --ok: #5FBF96;
  --warn: #E0A94A;
  --hl-key: #9BBFE8;
  --hl-str: #7FC9A3;
  --hl-attr: #D9B27C;
  --hl-num: #E0A0BE;
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--serif);
  font-size: 17px;
  line-height: 1.6;
  -webkit-text-size-adjust: 100%;
}

.page {
  max-width: calc(var(--measure) + var(--spine) + 4rem);
  margin: 0 auto;
  padding: 4rem 2rem 6rem;
}

a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:focus-visible, summary:focus-visible, button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 2px;
}

.masthead { margin-bottom: 3rem; }
.masthead h1 {
  font-size: 2.1rem;
  line-height: 1.15;
  margin: 0 0 0.6rem;
  font-weight: 600;
  letter-spacing: -0.012em;
  text-wrap: balance;
}
.byline {
  font-family: var(--sans);
  font-size: 0.8125rem;
  color: var(--muted);
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.9rem;
}
.byline .model { font-family: var(--mono); font-size: 0.78rem; }

.label {
  font-family: var(--sans);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 0.75rem;
}

.panel {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 6px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 2rem;
}

.meta-list {
  margin: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.35rem 1.25rem;
  font-family: var(--sans);
  font-size: 0.8125rem;
}
.meta-list dt { color: var(--muted); }
.meta-list dd { margin: 0; overflow-wrap: anywhere; }
.meta-list dd.mono { font-family: var(--mono); font-size: 0.76rem; }

.contents ol { margin: 0; padding-left: 1.25rem; font-family: var(--sans); font-size: 0.8125rem; }
.contents li { margin-bottom: 0.3rem; }
.contents a { color: var(--ink); text-decoration-color: var(--rule); }
.contents a:hover { text-decoration-color: var(--accent); }

.files { display: grid; gap: 0.75rem; }
.file {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 0.75rem;
  padding: 0.75rem 0.9rem;
  background: var(--ground);
  border: 1px solid var(--rule);
  border-radius: 5px;
}
.file .name { font-family: var(--mono); font-size: 0.85rem; font-weight: 600; }
.file .detail { font-family: var(--sans); font-size: 0.75rem; color: var(--muted); }
.file .detail.warn { color: var(--warn); }

.attachments {
  margin: 0.9rem 0 0;
  padding-left: var(--spine);
  max-width: var(--measure);
}
.attachments .label { margin-bottom: 0.4rem; }
.reply .body .attachments { padding-left: 0; }

.controls {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 2.5rem;
  font-family: var(--sans);
}
.controls button {
  font: inherit;
  font-size: 0.75rem;
  color: var(--muted);
  background: none;
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 0.3rem 0.7rem;
  cursor: pointer;
}
.controls button:hover { color: var(--ink); border-color: var(--muted); }

.prompt {
  position: relative;
  margin: 3.5rem 0 0;
  padding-left: var(--spine);
  max-width: var(--measure);
  font-family: var(--serif);
  font-size: 1.3rem;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -0.005em;
  text-wrap: pretty;
}
.prompt:first-of-type { margin-top: 0; }
.prompt.clamped {
  --lines: 3;
  display: -webkit-box;
  -webkit-line-clamp: var(--lines);
  line-clamp: var(--lines);
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.prompt.clamped .n { position: static; }
.prompt .n {
  position: absolute;
  left: 0;
  top: 0.35em;
  font-family: var(--sans);
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.prompt-rest {
  margin: 0.75rem 0 0;
  padding-left: var(--spine);
  max-width: var(--measure);
  color: var(--ink);
}
.prompt-rest.clamped {
  --lines: 6;
  display: -webkit-box;
  -webkit-line-clamp: var(--lines);
  line-clamp: var(--lines);
  -webkit-box-orient: vertical;
  overflow: hidden;
  position: relative;
}
.more {
  display: none;
  margin: 0.4rem 0 0 var(--spine);
  font: 600 0.75rem var(--sans);
  color: var(--accent);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.clamped + .more { display: block; }

.reply {
  margin: 0.9rem 0 0 var(--spine);
  border-left: 2px solid var(--rule);
  padding-left: 1.1rem;
  max-width: var(--measure);
}
.reply > summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  font-family: var(--sans);
  font-size: 0.8125rem;
  color: var(--muted);
  padding: 0.15rem 0;
}
.reply > summary::-webkit-details-marker { display: none; }
.reply > summary::before {
  content: "";
  flex: none;
  width: 0.4rem;
  height: 0.4rem;
  border: solid currentColor;
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(-45deg) translate(-1px, -1px);
  transition: transform 0.15s ease;
}
.reply[open] > summary::before { transform: rotate(45deg) translate(-2px, -2px); }
.reply > summary .who { font-weight: 600; color: var(--ink); flex: none; }
.reply > summary .n { font-variant-numeric: tabular-nums; flex: none; }
.reply > summary .excerpt {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
}
.reply[open] > summary .excerpt { display: none; }
.badge {
  flex: none;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--accent-ink);
  background: var(--raised);
  border-radius: 3px;
  padding: 0.1rem 0.4rem;
}
.reply .body { padding: 0.35rem 0 1rem; }
.reply .body > *:first-child { margin-top: 0; }
.reply .body > *:last-child { margin-bottom: 0; }

.stamp { font-family: var(--sans); font-size: 0.75rem; color: var(--muted); font-variant-numeric: tabular-nums; }

.tools { margin: 1rem 0; }
.tools > summary {
  cursor: pointer;
  font-family: var(--sans);
  font-size: 0.75rem;
  color: var(--muted);
}
.tool {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.6rem;
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--muted);
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--rule);
}
.tool .op { color: var(--ink); font-weight: 600; }

p { margin: 0 0 1rem; max-width: var(--measure); }
h1, h2, h3, h4 { text-wrap: balance; }
.body h1, .body h2, .body h3 {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 1.5rem 0 0.5rem;
}
ul, ol { max-width: var(--measure); padding-left: 1.3rem; }
li { margin-bottom: 0.3rem; }
blockquote {
  margin: 1rem 0;
  padding-left: 1rem;
  border-left: 2px solid var(--rule);
  color: var(--muted);
}
hr { border: 0; border-top: 1px solid var(--rule); margin: 2rem 0; }

code {
  font-family: var(--mono);
  font-size: 0.83em;
  background: var(--surface);
  padding: 0.1em 0.3em;
  border-radius: 3px;
}
pre {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 5px;
  padding: 0.9rem 1rem;
  overflow-x: auto;
  font-size: 0.8rem;
  line-height: 1.55;
}
pre code { background: none; padding: 0; font-size: inherit; }

table { border-collapse: collapse; font-size: 0.875rem; margin: 1rem 0; }
.scroll-x { overflow-x: auto; max-width: 100%; }
th, td { border: 1px solid var(--rule); padding: 0.35rem 0.6rem; text-align: left; }
th { background: var(--surface); font-family: var(--sans); font-size: 0.8rem; }

img { max-width: 100%; height: auto; }

.token.comment, .token.prolog, .token.doctype, .token.cdata { color: var(--muted); font-style: italic; }
.token.punctuation, .token.operator { color: var(--muted); }
.token.tag, .token.keyword, .token.selector, .token.important, .token.atrule { color: var(--hl-key); }
.token.string, .token.attr-value, .token.char, .token.regex { color: var(--hl-str); }
.token.attr-name, .token.property, .token.class-name, .token.function { color: var(--hl-attr); }
.token.number, .token.boolean, .token.constant, .token.symbol { color: var(--hl-num); }
.token.entity, .token.url { color: var(--accent); }

.colophon {
  margin-top: 5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--rule);
  font-family: var(--sans);
  font-size: 0.75rem;
  color: var(--muted);
}
.colophon a { color: var(--muted); }

@media (max-width: 40rem) {
  :root { --spine: 0rem; }
  .page { padding: 2.5rem 1.15rem 4rem; }
  .prompt .n { position: static; display: block; margin-bottom: 0.3rem; }
  .reply { margin-left: 0; }
  .reply > summary .excerpt { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}

@media print {
  body { background: #fff; color: #000; font-size: 11pt; }
  .controls, .more { display: none; }
  .page { max-width: none; padding: 0; }
  .reply { break-inside: avoid; }
  .prompt-rest.clamped { display: block; -webkit-line-clamp: none; line-clamp: none; overflow: visible; }
  a { text-decoration: none; color: #000; }
}
`;

// --- markdown ----------------------------------------------------------
// markdown-it is configured in one place so no call path can end up with
// different options. html:false is already the default and is set anyway, as
// documentation: message text routinely contains HTML source, because writing
// HTML is what these conversations are for.

var markdownRenderer = null;

function messageMarkdown() {
  if (markdownRenderer) return markdownRenderer;
  if (typeof markdownit === 'undefined') {
    throw new Error('Markdown support is not loaded on this page.');
  }

  markdownRenderer = markdownit({
    html: false,
    linkify: false,
    typographer: false,
    highlight: highlightCode
  });

  return markdownRenderer;
}

// The fence's declared language, never a guess: an unknown or absent language
// renders as plain monospace rather than being confidently mis-coloured.
function highlightCode(code, language) {
  if (typeof Prism === 'undefined' || !language) return '';
  const grammar = Prism.languages[language.toLowerCase()];
  if (!grammar) return '';
  try {
    return Prism.highlight(code, grammar, language.toLowerCase());
  } catch (error) {
    return '';
  }
}

function renderMessageMarkdown(text) {
  return messageMarkdown().render(String(text ?? ''));
}

// Tables and long code have to scroll inside their own box; the page body never
// scrolls sideways.
function wrapWideBlocks(html) {
  return html.replace(/<table>/g, '<div class="scroll-x"><table>').replace(/<\/table>/g, '</table></div>');
}

function renderBody(text) {
  return wrapWideBlocks(renderMessageMarkdown(text));
}

// --- metadata ----------------------------------------------------------

// The frontgraph field set, as values rather than YAML, so the head, the
// visible block and the Markdown frontmatter cannot disagree about it.
function documentMetadata(data, opts = {}) {
  const tags = normalizeTags(opts.tags);
  return {
    title: data.name || 'Untitled Conversation',
    date: formatDateYYYYMMDD(data.created_at),
    created: data.created_at || '',
    updated: data.updated_at || '',
    type: 'conversation',
    status: 'reference',
    frontgraphVersion: FRONTGRAPH_VERSION,
    project: opts.project || data.project_name || (data.project && data.project.name) || 'None',
    contributor: opts.contributor || '',
    tags,
    source: 'claude-conversation',
    sourceUrl: `https://claude.ai/chat/${data.uuid || ''}`,
    model: data.model || '',
    modelSource: data.model_source || (data.model ? 'reported' : 'inferred'),
    sessionId: data.uuid || '',
    summary: collapseWhitespace(data.summary)
  };
}

// session-id and source-url are the same identifier in two spellings, so they
// are one decision: a document published on its own carries neither, and one
// inside a provenance bundle carries both, where the identifiers are the
// evidence rather than an exposure.
function carriesIdentifiers(opts) {
  return opts.bundled === true;
}

function metaTag(name, content) {
  if (!content) return '';
  return `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}">`;
}

function headMetadata(meta, opts) {
  const lines = [
    metaTag('description', meta.summary),
    metaTag('keywords', meta.tags.join(', ')),
    metaTag('generator', meta.model),
    metaTag('dcterms.created', meta.created),
    metaTag('dcterms.modified', meta.updated),
    metaTag('dcterms.type', meta.type),
    metaTag('frontgraph:model-source', meta.modelSource),
    meta.contributor ? metaTag('dcterms.contributor', meta.contributor) : '',
    `<meta property="og:title" content="${escapeHtml(meta.title)}">`
  ];

  if (carriesIdentifiers(opts)) {
    lines.push(`<link rel="canonical" href="${escapeHtml(meta.sourceUrl)}">`);
  }

  lines.push(`<script type="application/ld+json">${jsonLd(meta, opts)}</script>`);
  return lines.filter(Boolean).join('\n  ');
}

// Schema.org covers nearly the whole frontgraph set with real vocabulary, so
// the machine-readable copy is standard rather than a shape only this project
// can read. Reversing this mapping has to reproduce the frontmatter exactly.
function jsonLd(meta, opts) {
  const node = {
    '@context': 'https://schema.org',
    '@type': 'Conversation',
    additionalType: meta.source,
    name: meta.title,
    dateCreated: meta.created,
    dateModified: meta.updated,
    creativeWorkStatus: meta.status,
    schemaVersion: `frontgraph-${meta.frontgraphVersion}`
  };

  if (meta.summary) node.abstract = meta.summary;
  if (meta.tags.length) node.keywords = meta.tags;
  if (meta.project && meta.project !== 'None') node.isPartOf = { '@type': 'CreativeWork', name: meta.project };
  if (meta.contributor) node.contributor = { '@type': 'Person', name: meta.contributor };
  if (meta.model) node.creator = { '@type': 'SoftwareApplication', name: meta.model, applicationCategory: 'AI model' };
  if (carriesIdentifiers(opts)) {
    node.identifier = meta.sessionId;
    node.url = meta.sourceUrl;
  }

  // The JSON goes inside a script element, so a literal </script> anywhere in a
  // title or summary would close it early.
  return JSON.stringify(node, null, 2).replace(/</g, '\\u003c');
}

function metadataRow(term, value, mono) {
  if (!value) return '';
  return `<dt>${escapeHtml(term)}</dt><dd${mono ? ' class="mono"' : ''}>${escapeHtml(value)}</dd>`;
}

function metadataBlock(meta, opts) {
  const rows = [
    metadataRow('Created', formatStamp(meta.created)),
    metadataRow('Updated', formatStamp(meta.updated)),
    metadataRow('Model', meta.model, true),
    metadataRow('Model source', meta.modelSource),
    metadataRow('Project', meta.project !== 'None' ? meta.project : ''),
    metadataRow('Contributor', meta.contributor),
    metadataRow('Tags', meta.tags.join(', ')),
    metadataRow('Type', meta.type),
    metadataRow('Status', meta.status)
  ];

  if (carriesIdentifiers(opts)) {
    rows.push(metadataRow('Session', meta.sessionId, true));
  }

  return `<section class="panel">
    <p class="label">Record</p>
    <dl class="meta-list">${rows.filter(Boolean).join('\n      ')}</dl>
  </section>`;
}

function formatStamp(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return isNaN(date) ? String(iso) : date.toLocaleString();
}

function formatClock(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return isNaN(date) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// --- the conversation --------------------------------------------------

// Past this many characters a prompt is clamped rather than set in full.
var PROMPT_CLAMP = 320;
var PROMPT_MORE = '<button class="more" type="button">Show full prompt</button>';

// A prompt's first line becomes its heading, which makes the document outline
// the list of questions. A heading only accepts phrasing content, so anything
// past that line follows as ordinary block markup.
function splitPrompt(text) {
  const trimmed = String(text ?? '').trim();
  const breakAt = trimmed.indexOf('\n');
  const first = breakAt === -1 ? trimmed : trimmed.slice(0, breakAt);

  // A prompt opening with a fence would put markup in the outline, so it gets a
  // generated label and keeps all of its text in the body.
  if (/^\s*(```|~~~|<)/.test(first) || !first) {
    return { heading: 'Prompt', rest: trimmed };
  }

  return { heading: first, rest: breakAt === -1 ? '' : trimmed.slice(breakAt + 1).trim() };
}

// One line of the reply, for the summary of a collapsed turn. Markdown is
// stripped rather than rendered: it has to survive being cut mid-token.
function excerptOf(text, limit = 180) {
  const flat = collapseWhitespace(String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\s]+/gm, ' ')
    .replace(/[*_~]/g, ''));

  return flat.length > limit ? `${flat.slice(0, limit).trimEnd()}…` : flat;
}

// Files the person attached to a message. The Markdown export lists these, so
// an HTML export that dropped them carried less than its own transcript did.
function attachmentsHtml(message) {
  const items = [...(message.attachments || []), ...(message.files || [])];
  if (!items.length) return '';

  const rows = items.map(item => {
    const name = item.file_name || item.name || '(unnamed)';
    const detail = [
      item.file_size ? `${(item.file_size / 1024).toFixed(1)} KB` : '',
      item.file_type || item.mime_type || ''
    ].filter(Boolean).join(' · ');

    const card = `<div class="file"><span class="name">${escapeHtml(name)}</span>` +
      (detail ? `<span class="detail">${escapeHtml(detail)}</span>` : '') + '</div>';

    // Extracted text is what Claude actually read, so it belongs in the record —
    // behind a disclosure, because it is often the length of a document.
    return item.extracted_content
      ? card + `<details class="tools"><summary>Extracted text from ${escapeHtml(name)}</summary><pre><code>${escapeHtml(item.extracted_content)}</code></pre></details>`
      : card;
  });

  return `<div class="attachments"><p class="label">Attached</p><div class="files">${rows.join('')}</div></div>`;
}

function toolActivity(message, opts) {
  if (!wantsToolActivity(opts)) return '';

  const calls = (message.content || []).filter(block => block.type === 'tool_use');
  if (!calls.length) return '';

  const rows = calls.map(block => {
    const input = block.input || {};
    const target = input.path || input.file_path || (input.filepaths || [])[0] || input.command || input.description || '';
    return `<div class="tool"><span class="op">${escapeHtml(block.name)}</span><span>${escapeHtml(collapseWhitespace(target).slice(0, 120))}</span></div>`;
  });

  return `<details class="tools"><summary>${calls.length} tool ${calls.length === 1 ? 'call' : 'calls'}</summary>${rows.join('\n')}</details>`;
}

function thinkingBlocks(message, opts) {
  if (!wantsThinking(opts)) return '';

  const thoughts = (message.content || [])
    .filter(block => block.type === 'thinking' && block.thinking)
    .map(block => `<blockquote>${renderBody(block.thinking)}</blockquote>`);

  return thoughts.length ? `<details class="tools"><summary>Thinking</summary>${thoughts.join('\n')}</details>` : '';
}

function messageText(message) {
  const blocks = message.content
    ? message.content.filter(block => block.type === 'text').map(block => block.text).filter(Boolean)
    : (message.text ? [message.text] : []);
  return blocks.join('\n\n');
}

function badgeFor(message, produced) {
  const files = produced.get(message.uuid);
  if (files && files.length) {
    return files.map(file => `<span class="badge">${escapeHtml(file.name)}</span>`).join('');
  }

  const calls = toolCallCount(message);
  return calls ? `<span class="badge">${calls} tool ${calls === 1 ? 'call' : 'calls'}</span>` : '';
}

function renderConversationBody(data, opts, artifacts) {
  const produced = artifactsByMessage(artifacts);
  const showMetadata = opts.includeMetadata !== false;
  const parts = [];
  const contents = [];
  let exchange = 0;

  for (const message of getCurrentBranch(data)) {
    const text = messageText(message);

    if (message.sender === 'human') {
      exchange++;
      const { heading, rest } = splitPrompt(text);
      const id = `x${exchange}`;
      contents.push({ id, heading });

      // A prompt is never hidden behind a disclosure, only clamped: whichever
      // part runs long is limited in height with its full text still in the
      // document, so find-in-page, copy and screen readers get all of it.
      const longHeading = !rest && heading.length > PROMPT_CLAMP;
      parts.push(`<h2 class="prompt${longHeading ? ' clamped' : ''}" id="${id}"><span class="n">${exchange}</span>${escapeHtml(heading)}</h2>`);
      if (longHeading) parts.push(PROMPT_MORE);

      if (rest) {
        const long = rest.length > PROMPT_CLAMP;
        parts.push(`<div class="prompt-rest${long ? ' clamped' : ''}">${renderBody(rest)}</div>`);
        if (long) parts.push(PROMPT_MORE);
      }

      parts.push(attachmentsHtml(message));
      continue;
    }

    const stamp = showMetadata ? `<time class="stamp" datetime="${escapeHtml(message.created_at || '')}">${escapeHtml(formatClock(message.created_at))}</time>` : '';
    const summary = [
      exchange ? `<span class="n">${exchange}</span>` : '',
      '<span class="who">Claude</span>',
      stamp,
      `<span class="excerpt">${escapeHtml(excerptOf(text))}</span>`,
      badgeFor(message, produced)
    ].filter(Boolean).join('');

    parts.push(`<details class="reply"><summary>${summary}</summary>
      <div class="body">
        ${attachmentsHtml(message)}
        ${thinkingBlocks(message, opts)}
        ${toolActivity(message, opts)}
        ${renderBody(text)}
      </div>
    </details>`);
  }

  return { html: parts.filter(Boolean).join('\n\n'), contents, exchanges: exchange };
}

// A conversation can be real and hold nothing — created and abandoned, or a
// session whose log was all bookkeeping. Rendering a masthead over blank space
// leaves the reader unsure whether the export failed.
var EMPTY_NOTICE = `<section class="panel">
    <p class="label">Nothing to show</p>
    <p>This conversation has no messages. The export succeeded; there was
    nothing in it to write down.</p>
  </section>`;

function contentsList(contents) {
  if (contents.length < 2) return '';
  const items = contents
    .map(entry => `<li><a href="#${entry.id}">${escapeHtml(excerptOf(entry.heading, 90))}</a></li>`)
    .join('\n      ');
  return `<nav class="panel contents"><p class="label">Contents</p><ol>${items}</ol></nav>`;
}

// Artifacts are linked, not embedded, so the document stays publishable
// alongside them rather than becoming a container for them.
function filesSection(artifacts, opts) {
  if (!artifacts.length) return '';

  const cards = artifacts.map(file => {
    const href = artifactHref(file, opts);
    const name = href
      ? `<a class="name" href="${escapeHtml(href)}">${escapeHtml(file.name)}</a>`
      : `<span class="name">${escapeHtml(file.name)}</span>`;

    const details = [`${file.bytes.toLocaleString()} bytes`];
    if (file.published && file.published.differs_from_final) {
      details.push('published version differs from final');
    }
    if (file.status !== 'reconstructed') {
      details.push(file.status.replace(/-/g, ' '));
    }

    const warn = file.status !== 'reconstructed' ? ' warn' : '';
    return `<div class="file">${name}<span class="detail${warn}">${escapeHtml(details.join(' · '))}</span></div>`;
  });

  return `<section class="panel">
    <p class="label">Files produced</p>
    <div class="files">${cards.join('\n      ')}</div>
  </section>`;
}

function artifactHref(file, opts) {
  if (opts.artifactLinks === 'relative' && file.bundle_path) {
    return file.bundle_path;
  }
  return file.published ? file.published.url : '';
}

// --- the document ------------------------------------------------------

// Expand-all exists because find-in-page does not reach into a closed details
// element everywhere, and the print pair exists because a closed one prints
// closed. Both degrade to nothing with scripting off, which is why the document
// is readable without them.
var DOCUMENT_SCRIPT = `
(function () {
  var replies = function () { return Array.prototype.slice.call(document.querySelectorAll('details.reply')); };

  var expand = document.getElementById('expand-all');
  var collapse = document.getElementById('collapse-all');
  if (expand) expand.addEventListener('click', function () { replies().forEach(function (d) { d.open = true; }); });
  if (collapse) collapse.addEventListener('click', function () { replies().forEach(function (d) { d.open = false; }); });

  Array.prototype.forEach.call(document.querySelectorAll('.more'), function (button) {
    button.addEventListener('click', function () {
      var block = button.previousElementSibling;
      block.classList.remove('clamped');
      button.remove();
    });
  });

  var restore = [];
  window.addEventListener('beforeprint', function () {
    restore = replies().map(function (d) { return [d, d.open]; });
    restore.forEach(function (pair) { pair[0].open = true; });
  });
  window.addEventListener('afterprint', function () {
    restore.forEach(function (pair) { pair[0].open = pair[1]; });
  });
})();
`;

function documentShell({ title, head, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${head}
  <style>${DOCUMENT_STYLE}</style>
</head>
<body>
<div class="page">
${body}
</div>
<script>${DOCUMENT_SCRIPT}</script>
</body>
</html>
`;
}

function colophon(meta, opts, counts) {
  const bits = [
    `${counts.exchanges} ${counts.exchanges === 1 ? 'exchange' : 'exchanges'}`,
    meta.model ? `Model ${meta.model}` : '',
    meta.modelSource === 'inferred' ? 'model inferred from the conversation date' : '',
    `Exported ${new Date().toLocaleDateString()} with Claude Interaction Exporter`
  ].filter(Boolean);

  const link = carriesIdentifiers(opts)
    ? ` · <a href="${escapeHtml(meta.sourceUrl)}">View the conversation</a>`
    : '';

  return `<footer class="colophon">${escapeHtml(bits.join(' · '))}${link}</footer>`;
}

function convertToHtml(data, opts = {}) {
  const meta = documentMetadata(data, opts);
  const showMetadata = opts.includeMetadata !== false;
  const artifacts = opts.artifacts || replayArtifacts(data);
  const conversation = renderConversationBody(data, opts, artifacts);

  const empty = !conversation.html.trim();

  const body = [
    `<header class="masthead">
    <h1>${escapeHtml(meta.title)}</h1>
    <p class="byline"><span>${escapeHtml(formatStamp(meta.created))}</span>${meta.model ? `<span class="model">${escapeHtml(meta.model)}</span>` : ''}</p>
  </header>`,
    empty ? EMPTY_NOTICE : '',
    showMetadata ? metadataBlock(meta, opts) : '',
    filesSection(artifacts, opts),
    showMetadata ? contentsList(conversation.contents) : '',
    empty ? '' : `<div class="controls">
    <button id="expand-all" type="button">Expand all</button>
    <button id="collapse-all" type="button">Collapse all</button>
  </div>`,
    `<main class="conversation">\n${conversation.html}\n</main>`,
    colophon(meta, opts, conversation)
  ].filter(Boolean).join('\n\n');

  return documentShell({ title: meta.title, head: headMetadata(meta, opts), body });
}

// --- Cowork sessions ---------------------------------------------------
// A task is read from an event log rather than a message tree, so its turns
// arrive already classified. The document is the same one: the fired prompt
// leads, the run's turns follow, environment events stay out of the outline
// because nobody asked them anything.

function taskMetadata(session, opts = {}) {
  return {
    title: session.title || session.id,
    date: formatDateYYYYMMDD(session.created_at),
    created: session.created_at || '',
    updated: session.updated_at || '',
    type: 'task',
    status: 'reference',
    frontgraphVersion: FRONTGRAPH_VERSION,
    project: opts.project || 'None',
    contributor: opts.contributor || '',
    tags: normalizeTags(opts.tags),
    source: 'claude-cowork-session',
    sourceUrl: `https://claude.ai/cowork/${session.id || ''}`,
    model: session.model || '',
    modelSource: session.model ? 'reported' : 'inferred',
    sessionId: session.id || '',
    summary: collapseWhitespace(session.prompt).slice(0, 300)
  };
}

function coworkPartsHtml(parts, opts) {
  const chunks = [];

  for (const part of parts) {
    if (part.kind === 'text') {
      chunks.push(renderBody(part.text));
    } else if (part.kind === 'thinking' && wantsThinking(opts)) {
      chunks.push(`<details class="tools"><summary>Thinking</summary>${renderBody(part.text)}</details>`);
    } else if (part.kind === 'tool_use' && wantsToolActivity(opts)) {
      const input = JSON.stringify(part.input === undefined ? null : part.input, null, 2);
      chunks.push(`<details class="tools"><summary>Tool · ${escapeHtml(part.name)}</summary><pre><code class="language-json">${highlightCode(input, 'json') || escapeHtml(input)}</code></pre></details>`);
    } else if (part.kind === 'tool_result' && wantsToolActivity(opts)) {
      chunks.push(`<details class="tools"><summary>Tool result${part.id ? ` (${escapeHtml(part.id)})` : ''}</summary><pre><code>${escapeHtml(part.text)}</code></pre></details>`);
    } else if (part.kind === 'search_results' && wantsToolActivity(opts)) {
      const items = part.results
        .map(result => `<li>${result.url ? `<a href="${escapeHtml(result.url)}">${escapeHtml(result.title)}</a>` : escapeHtml(result.title)}</li>`)
        .join('');
      chunks.push(`<details class="tools"><summary>Search results</summary><ul>${items}</ul></details>`);
    } else if (part.kind === 'image' && wantsImages(opts)) {
      chunks.push(part.url
        ? `<p><a href="${escapeHtml(part.url)}">Image (${escapeHtml(part.media_type)})</a></p>`
        : `<p class="stamp">Image (${escapeHtml(part.media_type)}) — referenced here but not saved; this extension exports text, not files.</p>`);
    }
  }

  return chunks.join('\n');
}

function convertTaskToHtml(session, opts = {}) {
  const meta = taskMetadata(session, opts);
  const showMetadata = opts.includeMetadata !== false;
  const parts = [];
  const contents = [];
  let exchange = 0;

  // A task fired by a schedule has no typed prompt, so the title stands in as
  // the heading rather than the document having none.
  if (session.prompt || (session.turns || []).length) {
    exchange++;
    const { heading, rest } = splitPrompt(session.prompt || session.title || 'Session');
    contents.push({ id: 'x1', heading });
    const longHeading = !rest && heading.length > PROMPT_CLAMP;
    parts.push(`<h2 class="prompt${longHeading ? ' clamped' : ''}" id="x1"><span class="n">1</span>${escapeHtml(heading)}</h2>`);
    if (longHeading) parts.push(PROMPT_MORE);
    if (rest) {
      const long = rest.length > PROMPT_CLAMP;
      parts.push(`<div class="prompt-rest${long ? ' clamped' : ''}">${renderBody(rest)}</div>`);
      if (long) parts.push(PROMPT_MORE);
    }
  }

  for (const turn of session.turns || []) {
    // The fired prompt is already the heading; rendering its turn again would
    // duplicate it.
    if (turn.role === 'user' && turn === (session.turns || [])[0]) continue;

    const who = turn.kind === 'environment' ? 'Environment' : (turn.role === 'user' ? 'You' : 'Claude');
    const stamp = showMetadata ? `<time class="stamp" datetime="${escapeHtml(turn.created_at || '')}">${escapeHtml(formatClock(turn.created_at))}</time>` : '';
    const tools = turn.parts.filter(part => part.kind === 'tool_use').length;

    const summary = [
      `<span class="who">${escapeHtml(who)}</span>`,
      stamp,
      `<span class="excerpt">${escapeHtml(excerptOf(turn.text))}</span>`,
      tools ? `<span class="badge">${tools} tool ${tools === 1 ? 'call' : 'calls'}</span>` : ''
    ].filter(Boolean).join('');

    parts.push(`<details class="reply"><summary>${summary}</summary>
      <div class="body">${coworkPartsHtml(turn.parts, opts)}</div>
    </details>`);
  }

  const notice = session.complete === false
    ? `<section class="panel"><p class="label">Incomplete export</p><p>This transcript stops early because ${escapeHtml(session.truncated_reason || 'the event log could not be read to its end')}. Exporting again may produce a fuller one.</p></section>`
    : '';

  const body = [
    `<header class="masthead">
    <h1>${escapeHtml(meta.title)}</h1>
    <p class="byline"><span>${escapeHtml(formatStamp(meta.created))}</span>${meta.model ? `<span class="model">${escapeHtml(meta.model)}</span>` : ''}${session.scheduled ? '<span>scheduled run</span>' : ''}</p>
  </header>`,
    notice,
    parts.length ? '' : EMPTY_NOTICE,
    showMetadata ? metadataBlock(meta, opts) : '',
    `<div class="controls">
    <button id="expand-all" type="button">Expand all</button>
    <button id="collapse-all" type="button">Collapse all</button>
  </div>`,
    `<main class="conversation">\n${parts.join('\n\n')}\n</main>`,
    colophon(meta, opts, { exchanges: exchange })
  ].filter(Boolean).join('\n\n');

  return documentShell({ title: meta.title, head: headMetadata(meta, opts), body });
}
