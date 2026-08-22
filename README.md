# Conversation Frontgraph Exporter

A Chrome extension that saves your own Claude.ai conversations, Cowork sessions, and scheduled tasks to files on your computer — as Markdown with YAML frontmatter, plain text, or JSON.

The extension has no backend. It requests your conversations from Claude.ai using the same web API the site itself uses, builds the file in your browser, and saves it as a download. There is no account to create, no analytics, and no third-party service.

> **Not affiliated with Anthropic.** This is a community tool, forked from
> [socketteer/Claude-Conversation-Exporter](https://github.com/socketteer/Claude-Conversation-Exporter).

## Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Output](#output)
- [Permissions](#permissions)
- [Privacy](#privacy)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Changes from upstream](#changes-from-upstream)
- [Provenance](#provenance)
- [License](#license)

## Features

- **Export the conversation you are viewing** — one click from the toolbar popup.
- **Export Cowork sessions and scheduled tasks**, with their tool activity replayed into a readable transcript.
- **Browse, search, filter, and sort** your conversations and sessions from a single page.
- **Bulk export** selected rows, or everything matching your current filters, as a ZIP.
- **Three formats** — Markdown, plain text, or raw JSON.
- **YAML frontmatter** on Markdown exports, so files land in Obsidian or any other note system with their metadata already structured.
- **Model information is preserved.** Claude.ai's own export does not record which model each conversation used; this one does, and infers the model from the conversation's date when the API reports `null` (the default-model case).
- **Branch-aware.** Markdown and plain text follow the branch you have selected; JSON keeps every branch.

## Installation

**Prerequisites:** Chrome or another Chromium-based browser, and a Claude.ai account.

### Load the extension

1. Clone or download this repository.
2. Open `chrome://extensions/`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. Optionally pin it: click the puzzle-piece icon in the toolbar, then the pin beside "Conversation Frontgraph Exporter."

The `version_name` field in `manifest.json` is shown in small print at the bottom of the popup and at the top right of the browse page, so you can confirm which build is loaded after a reload.

### Configure your Organization ID

The extension needs your Claude.ai organization ID to build the API path it fetches from. This is a one-time step.

1. Sign in to Claude.ai.
2. In a new tab, open `https://claude.ai/api/organizations`. Raw JSON is expected here; it is not an error.
3. Find the value after `"uuid":` — it looks like `1a2b3c4d-5e6f-7890-abcd-ef1234567890`. Copy it without the quotation marks.
4. Right-click the extension icon → **Options**, or click the icon and use the setup link.
5. Paste the ID into **Organization ID**, click **Save Settings**, then click **Test Connection**. A successful test reports how many conversations it found.

If you belong to more than one Claude organization — a personal account and a school workspace, say — that page lists several entries. Use the `uuid` of the one whose conversations you want.

### Optional defaults

The Options page also holds three defaults that pre-fill every export: a **project** key, a **contributor** name, and a **tag** list. Each has its own Save button, and any export can override them.

One asymmetry is worth knowing. Editing **project** or **contributor** on the browse page writes the new value back as the saved default, while editing **tags** there does not — a one-off tag list never becomes permanent. The popup writes none of the three back.

## Usage

### Export the current conversation

1. Open a conversation (`claude.ai/chat/...`) or a Cowork session (`claude.ai/cowork/...`).
2. Click the extension icon.
3. Choose a format, and optionally fill in project, contributor, and tags.
4. Click **Export Current Conversation**.

The extension detects which of the two you are on and exports accordingly.

### Browse and bulk export

Click the extension icon → **Browse All Conversations**. The browse page lists conversations and Cowork sessions in separate tables, where you can:

- Search by name, and filter by model or by Claude Project
- Sort by created or updated date, name, or project
- Check individual rows and click **Export Selected**
- Click **Export All** to export every conversation matching your current filters
- Limit the task table to scheduled runs only

**Export All** and **Export Selected** act on the conversation table. The task table has its own **Export All Tasks** button, which exports the sessions it is currently listing.

Bulk exports are bundled into a ZIP containing an `export_summary.json` manifest, with task exports under a `tasks/` folder. Conversations are fetched three at a time, with a pause between batches to stay well inside rate limits. A progress dialog tracks the run and can cancel it; anything that fails is listed at the end rather than aborting the batch.

The popup also has an **Export All Conversations** button, which does not produce a ZIP: in Markdown or plain text it downloads one file per conversation, which will make Chrome ask about multiple downloads, and in JSON it writes a single combined file built from the conversation-list endpoint, so it carries titles and metadata but no message history. For bulk work, and for complete JSON, use the browse page.

## Output

### Formats

| Format | What you get | Best for |
| --- | --- | --- |
| **Markdown** | Human-readable, with YAML frontmatter. Current branch only. | Obsidian, note-taking, coursework, writing |
| **Plain text** | `Human:` / `Assistant:` prefixes, shortened to `H:`/`A:` after the first. Current branch only. | Pasting into another tool or a text editor |
| **JSON** | Complete raw data, including every branch and all metadata. | Archiving, scripts, data analysis |

Markdown files are named `<YYYY-MM-DD>-<slug>.md`. The **Include metadata** checkbox in the popup and on the browse page controls the extra detail inside the file — per-message timestamps, attachment lists, the header block above the transcript, and, in Markdown exports of Cowork sessions, the tool-call and tool-result blocks themselves. YAML frontmatter is always written.

### Frontmatter

Every Markdown export opens with a structured YAML header:

```yaml
---
title: "..."
date: 2026-07-17
created: "2026-07-17T19:23:53.603854Z"
updated: "2026-07-17T20:25:25.293495Z"
type: conversation
status: reference
project: "pdf2md"
contributor: Steve
tags:
  - research
  - claude-api
source: claude-conversation
source_url: "https://claude.ai/chat/..."
model: claude-opus-4-8
session_id: ...
summary: "..."
---
```

`title`, `date`, `created`, `updated`, `source_url`, `model`, `session_id`, and `summary` come from data the Claude.ai API already returns — including the per-conversation summary Claude writes itself. `project` auto-fills from the conversation's Claude Project name, falling back to the literal `None`; the project field in the popup or browse page overrides either. `contributor` and `tags` come from what you type.

Cowork sessions and scheduled tasks use `type: task` and `source: claude-cowork`, and add `routine`, `trigger_id`, `scheduled`, and `fire_reason`, so a run started by a schedule is distinguishable from one you started by hand.

### Tags

Tags are per-export: type a comma-separated list and every file in that export carries it. Input is cleaned rather than rejected — a leading `#` comes off, tags are lowercased, spaces inside a tag become hyphens, characters outside the set Obsidian accepts (letters, digits, `_`, `-`, `/`) are dropped, and duplicates collapse. Markdown gets a YAML block sequence, JSON gets a `tags` array, and plain text gets a `Tags:` line. The Options page sets the field's starting value; per-export edits do not overwrite it.

## Permissions

`manifest.json` requests four things: access to one website, and three browser capabilities. Only the website access raises a warning at install time — *Read and change your data on claude.ai.*

| Requested | Used for |
| --- | --- |
| `https://claude.ai/*` | Reading your conversations and sessions from Claude.ai's API. It is the only host in the manifest and the only host contacted. |
| `activeTab` | Reading the address of the current tab when you click the icon, to identify which conversation to export. Granted on click, for that one tab. No browsing history is enumerated or stored. |
| `storage` | Saving the four settings you enter: organization ID, and default project, contributor, and tags. |
| `scripting` | Loading the extension's own two bundled files into Claude.ai tabs that were already open when it was installed or updated, so the first export works without a manual reload. Nothing is fetched or evaluated from outside the extension. |

Within those declarations:

- No host other than `claude.ai` is listed in the manifest, so no other site can be read or contacted.
- Passwords, cookies, and session tokens are never read. The browser attaches your existing sign-in to each request, as it does for any link you click on the site.
- No data is sent to the developer or a third party. Exports are written to a file on your computer.
- Nothing is fetched until you click a button.
- Every request the extension makes is a read; no conversation is modified or deleted.

Two properties worth noting:

- **Exported files are plain, unencrypted text**, as readable as any other document once on disk — relevant if you sync them to a shared drive or a public repository.
- **The four settings use Chrome's syncing storage.** With Chrome Sync on, those four values — including a contributor name, which may be your real name — travel between your own signed-in browsers via Google, the same way bookmarks do. Conversation content is never stored this way.

## Privacy

No data ever reaches the developer or any third party: the extension has no backend, no analytics, and no telemetry, and the only server it contacts is Claude.ai itself. See [PRIVACY.md](PRIVACY.md) for the full policy.

## Limitations

- Markdown and plain text export only the currently selected branch of a multi-branch conversation. Use JSON for all branches.
- Large bulk exports can take several minutes: the browse page fetches three conversations at a time with a pause between batches, and the popup's Export All fetches them one at a time.
- Plain-text exports of Cowork sessions carry the prose only. Tool activity appears in the Markdown and JSON forms.
- Some special content types, notably artifacts, may not render perfectly in Markdown.
- Attachment *files* are not downloaded. An attachment appears as a reference line with its name, size, and type; if Claude.ai extracted text from it, that text is included, but the original file is not.
- An individual conversation can occasionally fail to fetch or parse. A batch skips it and reports it at the end rather than aborting.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Organization ID not configured" | Follow [Configure your Organization ID](#configure-your-organization-id). Copy the whole ID, dashes included, without quotation marks. |
| "Invalid Organization ID format" | The ID must be a UUID — 8-4-4-4-12 characters separated by dashes. A conversation ID or a truncated paste will be rejected. |
| "Not authenticated" | Sign in to Claude.ai, reload the page, and try again. |
| "Access denied" | The organization ID probably belongs to a different organization than the conversations you are exporting. Recheck `https://claude.ai/api/organizations`. |
| Nothing happens when you click Export | If the tab was already open when you installed or updated the extension, reload it once. The extension tries to handle this itself, but a reload always fixes it. |
| Some conversations fail in a batch | The batch continues and lists what failed at the end; the browser console has the specifics. |
| The download never appeared | Chrome may be blocking multiple automatic downloads. Bulk-export from the browse page instead, which produces a single ZIP. |

## Development

```
Claude-Conversation-Exporter/
├── manifest.json        # Extension configuration and permissions
├── background.js        # Service worker; injects content scripts into open tabs
├── content.js           # Runs on claude.ai; orchestrates fetch → render → download
├── content.css          # Styles for the content script
├── utils.js             # Shared: API fetches, Cowork parsing, all format renderers
├── popup.html / .js     # Toolbar popup
├── options.html / .js   # Settings page
├── browse.html / .js    # Conversation and session browser
├── jszip.min.js         # Bundled locally — used for ZIP bulk exports
├── generate-icons.html  # Dev helper that redraws the icons and popup header
└── icon*.png, popup-header.png
```

The extension reads four Claude.ai endpoints, all authenticated GETs returning only data the signed-in user can already see:

| Endpoint | Purpose |
| --- | --- |
| `/api/organizations/{orgId}/chat_conversations` | List conversations |
| `/api/organizations/{orgId}/chat_conversations/{id}` | Full message history for one conversation |
| `/v1/code/sessions` | List Cowork sessions and scheduled tasks |
| `/v1/code/sessions/{id}/events/stream` | Event log for one session |

There is no build step and no dependency install: load the folder unpacked, and reload it from `chrome://extensions/` after changes. JSZip is vendored as `jszip.min.js`; no code is loaded from a remote source at runtime.

## Changes from upstream

Forked from [socketteer/Claude-Conversation-Exporter](https://github.com/socketteer/Claude-Conversation-Exporter), with four functional additions:

1. **YAML frontmatter on Markdown exports**, plus dated `<YYYY-MM-DD>-<slug>.md` filenames and per-export tags. See [Frontmatter](#frontmatter).
2. **Project filter, sort, and column on the browse page**, matching the existing model filter. Conversations in no project group under a "No Project" bucket so they stay filterable.
3. **Checkbox selection with an Export Selected button.** Selection is tracked independently of the filters, so checking some rows, changing the search, and checking more does not lose the earlier picks.
4. **Cowork session and scheduled task export.** The popup recognizes `claude.ai/cowork/<id>`, replaying the session's event log into a readable transcript that includes tool activity — which searches ran, what they returned, what files were written — since that is the provenance of a task's result. The browse page lists sessions alongside conversations, and batch export can be limited to scheduled runs.

Two upstream defects are also fixed: [issue #12](https://github.com/socketteer/Claude-Conversation-Exporter/issues/12), a DOM XSS in the browse page where conversation titles were inserted into `innerHTML` unescaped, so a title like `<img src=x onerror=...>` would execute; and an overly broad `web_accessible_resources` match (`<all_urls>`, narrowed to `https://claude.ai/*`). The accent color is green rather than upstream's purple, so it is obvious at a glance which build is loaded.

## Provenance

The fork's changes were specified and directed by Steven M. Schneider (SUNY Polytechnic Institute); the code was written by Claude Code (Anthropic) — Claude Sonnet 5 — across sessions dated 2026-07-16 through 2026-07-18, with Cowork session export and the Chrome Web Store submission material added in August 2026.

Upstream's original code was written by Claude Opus 4.1 in collaboration with a human developer. ZIP archives use [JSZip](https://stuk.github.io/jszip/).

## License

Upstream (`socketteer/Claude-Conversation-Exporter`) carries no license — no `LICENSE` file, and its README's License section is an unfilled placeholder. There is accordingly no license to inherit, and this fork is shared publicly as-is under the same unlicensed status, not under any explicit grant.
