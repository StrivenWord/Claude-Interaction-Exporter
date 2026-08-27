# Chrome Web Store submission notes

Maintainer notes for the unlisted store listing. Not linked from the README, which stays store-agnostic until the listing is approved.

## Package

Build the upload package with `manifest.json` at the root of the ZIP:

```bash
zip -r ../conversation-frontgraph-exporter.zip . \
  -x '*.git*' -x '*.DS_Store' -x 'generate-icons.html' \
  -x 'README.md' -x 'PRIVACY.md' -x 'docs/*'
```

## Single purpose

Export the signed-in user's own Claude.ai conversations and Cowork sessions to local Markdown, plain-text, or JSON files with YAML frontmatter, for personal archiving and coursework.

## Remote code: No

Every `<script src>` points at a packaged file, `jszip.min.js` is bundled, there are no ES module imports or dynamic `import()`, and there is no `eval`, `new Function`, or `importScripts` anywhere. Both `chrome.scripting.executeScript` call sites pass only `files:` referencing local files — never a code string. Fetching JSON from claude.ai is data, not remote code.

## Data usage disclosures

Check *Personal communications*, *Website content*, and *Personally identifiable information*.

Leave *Authentication information* unchecked — `credentials: 'include'` delegates to the browser and the code never touches the credential. Leave *Web history* unchecked — the extension reads one tab's URL on click and does not enumerate history. Leave *User activity*, *Location*, *Health*, and *Financial* unchecked. All three limited-use certifications can be signed truthfully.

## Privacy policy URL

[`PRIVACY.md`](../PRIVACY.md) is the canonical text; link to its rendered GitHub URL on the Privacy tab. Keep the dashboard disclosures and the categories in that file in sync — the dashboard makes you certify they match.

## Permission justifications

Each field caps at 1,000 characters.

**`activeTab`** — The popup reads the active tab's URL on toolbar click to determine whether the user is viewing a conversation (`/chat/<id>`) or a Cowork session (`/cowork/<id>`) and to extract that ID, then messages the content script in that tab. It is also what allows a clear "navigate to a Claude.ai conversation first" error when the active tab is something else. Granted only on click, for that one tab.

**`storage`** — Persists four values entered on the extension's own options page: the organization ID needed to construct the API path, plus optional project, contributor, and tag defaults that pre-fill exported frontmatter. No conversation content, page content, or credentials are stored.

**`scripting`** — Manifest content scripts only load on fresh page loads, so tabs already open at install or update have none. `executeScript` injects the same two packaged files (`utils.js`, `content.js`) into claude.ai tabs so the first export works without a manual reload; also the fallback when the popup finds no content script. `files:` only — no code strings, no remote code.

**Host permission `https://claude.ai/*`** — Authenticated GETs to four claude.ai endpoints, returning only data the signed-in user can already see: `/api/organizations/{orgId}/chat_conversations` (list), `/api/organizations/{orgId}/chat_conversations/{id}` (full message history), `/v1/code/sessions` (list Cowork sessions and scheduled tasks), `/v1/code/sessions/{id}/events/stream` (one session's event log). Responses are rendered and downloaded locally. claude.ai is the only host in the manifest and the only host contacted; nothing is sent to the developer or any third party.

## After approval

The README's Installation section covers loading unpacked only. Once the listing is live, add the install-from-link path for students above it: the unlisted URL, **Add to Chrome**, pinning the icon, then the existing Organization ID setup.
