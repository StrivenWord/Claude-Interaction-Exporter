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
- **Export Cowork sessions and scheduled tasks**, with their tool activity, searches, and images replayed into a readable transcript — and a clear label if only part of the log could be read.
- **Browse, search, filter, and sort** your conversations and sessions from a single page.
- **Bulk export** selected rows, or everything matching your current filters, as a ZIP.
- **Three formats** — Markdown, plain text, or raw JSON.
- **YAML frontmatter** on Markdown exports, so files land in Obsidian or any other note system with their metadata already structured.
- **Model information is preserved.** Claude.ai's own export does not record which model each conversation used; this one does, and infers the model from the conversation's date when the API reports `null` (the default-model case) — recording which of the two it was, so a guess is never mistaken for a fact.
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

Click the extension icon → **Browse All Conversations**. The browse page lists conversations and Cowork sessions in one table, where you can:

- Search by name, and filter by model or by Claude Project. A Cowork session's model isn't in the list response, so it is read on demand the first time a filter needs it
- Sort by created or updated date, name, or project
- Check individual rows and click **Export Selected**
- Click **Export All** to export every interaction matching your current filters
- Limit the list to scheduled runs only, when viewing Cowork sessions

**Export All** and **Export Selected** both act on the single table, so a mixed selection of conversations and sessions exports together.

Bulk exports are bundled into a ZIP containing an `export_summary.json` manifest. Interactions are fetched three at a time, with a pause between batches to stay well inside rate limits. A progress dialog tracks the run and can cancel it; anything that fails is listed at the end rather than aborting the batch.

The popup's **Export All Conversations** button produces the same kind of ZIP, using the same engine — it just has no progress dialog, and it always covers every conversation rather than a filtered subset. Use the browse page when you want to choose what goes in.

## Output

### Formats

| Format | What you get | Best for |
| --- | --- | --- |
| **Markdown** | Human-readable, with YAML frontmatter. Current branch only. | Obsidian, note-taking, coursework, writing |
| **Plain text** | `Human:` / `Assistant:` prefixes, shortened to `H:`/`A:` after the first. Current branch only. | Pasting into another tool or a text editor |
| **JSON** | Conversations: the complete raw API payload, including every branch. Cowork sessions: the transcript in this extension's own shape — every content block, including ones this build can't render, but not the raw event log those blocks were derived from, which would double the file for nothing. | Archiving, scripts, data analysis |

Every export is named `<YYYY-MM-DD>-<slug>.<ext>`, whichever format it is and whichever button produced it.

Inside a ZIP, a name that is already taken falls back to something that actually tells the files apart, rather than to a counter. This matters most for scheduled tasks, since every run of one routine carries the same title and therefore the same date and slug. The order tried is:

| | Name | When |
| --- | --- | --- |
| 1 | `<YYYY-MM-DD>-<slug>.<ext>` | Always tried first, so nothing changes for a file whose name is free |
| 2 | `<YYYY-MM-DD>T<HH-MM>-<slug>.<ext>` | On a collision — the time of day is what separates two runs of one routine |
| 3 | `<YYYY-MM-DD>-<slug>-<id>.<ext>` | When the timestamps match too |
| 4 | `…-2`, `…-3` | Last resort, so the process always terminates |

### What goes inside

Four checkboxes control the contents. All of them appear in both the popup and the browse page.

| Checkbox | Default | What it adds |
| --- | --- | --- |
| **Include metadata** | on | Per-message timestamps, attachment lists, the header block above the transcript, and environment-event notes |
| **Tool activity** | on | Tool calls, their results, and web-search results in Cowork exports |
| **Images** | on | Image references — `![…](…)` in Markdown when the image has a URL, otherwise a note that it was there. The files themselves are never downloaded |
| **Thinking** | off | Claude's reasoning blocks. Long, and rarely what an archive is for |

Tool activity used to be bundled under **Include metadata**, which meant that turning metadata off silently deleted the substance of a task whose whole product was a written file. It is its own control now, and it applies to plain-text exports as well as Markdown.

YAML frontmatter is always written.

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
frontgraph-version: 2
project: "pdf2md"
contributor: "Steve"
tags:
  - research
  - claude-api
source: claude-conversation
source-url: "https://claude.ai/chat/..."
model: "claude-opus-4-8"
model-source: reported
session-id: "..."
summary: "..."
---
```

All field names are hyphenated, not underscored — `source-url` and `session-id`, not `source_url`/`session_id`. `title`, `date`, `created`, `updated`, `source-url`, `model`, `session-id`, and `summary` come from data the Claude.ai API already returns — including the per-conversation summary Claude writes itself. `project` auto-fills from the conversation's Claude Project name, falling back to the literal `None`; the project field in the popup or browse page overrides either. `contributor` and `tags` come from what you type. Every free-text field (`title`, `contributor`, `project`, `model`, `session-id`, `summary`) is quoted and escaped, so a colon, quote mark, or pasted newline inside a title or a contributor name can't corrupt the block.

`model-source` is either `reported` or `inferred`. Claude.ai returns no model for a conversation that used the default model of its day, so the `model` above is sometimes a date-based guess — and an export that wrote a guess exactly like a reported value would be asserting something it doesn't know. Cowork sessions gain a `models` list when more than one model answered during the run, which happens on a fallback or after a compaction.

`frontgraph-version` identifies the shape of this frontmatter itself — bumped only when a field here is added, renamed, or reinterpreted, so a script or Dataview query reading these files later can tell which version it's looking at. It isn't a per-file revision counter; a given export never changes after being written.

Cowork sessions and scheduled tasks use `type: task` and `source: claude-cowork`, and add `routine`, `trigger-id`, `scheduled`, and `fire-reason`, so a run started by a schedule is distinguishable from one you started by hand. `routine`, `trigger-id`, and `fire-reason` are omitted entirely (not written as empty) on a session that wasn't fired by a schedule.

They also carry `complete`, and `truncated-reason` when `complete` is false. A Cowork session is read from a paged event stream rather than fetched in one piece, so unlike a conversation it is possible to get part of one. When that happens the export says so — in the frontmatter, in a note at the top of the transcript, and in the message the popup or browse page shows — instead of looking like a complete export of a shorter session. Nothing is written at all when no events could be read.

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
- Large bulk exports can take several minutes: every bulk path fetches three interactions at a time with a pause between batches.
- Some special content types, notably artifacts, may not render perfectly in Markdown.
- Attachment *files* are not downloaded. An attachment appears as a reference line with its name, size, and type; if Claude.ai extracted text from it, that text is included, but the original file is not.
- An individual conversation can occasionally fail to fetch or parse. A batch skips it and reports it at the end rather than aborting.
- The Cowork session list is followed past its page size, but stops after ten pages. If it stops there the browse page says so rather than presenting a short list as everything. Only sessions tagged `cowork-remote` are listed at all — that is what the web app's own sessions carry, and the parameters on this endpoint are undocumented enough that widening the query blind could return an unrelated set rather than more of the right one.
- A Cowork session's event log is read in pages, and a session that is still being written to can only be read as far as it has got. Such an export is labelled `complete: false` rather than presented as whole.
- Chat conversations carry only the text of each message; a chat's own thinking blocks and images are not exported. The Cowork checkboxes above apply to Cowork sessions.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Organization ID not configured" | Follow [Configure your Organization ID](#configure-your-organization-id). Copy the whole ID, dashes included, without quotation marks. |
| "Invalid Organization ID format" | The ID must be a UUID — 8-4-4-4-12 characters separated by dashes. A conversation ID or a truncated paste will be rejected. |
| "Not authenticated" | Sign in to Claude.ai, reload the page, and try again. |
| "Access denied" | The organization ID probably belongs to a different organization than the conversations you are exporting. Recheck `https://claude.ai/api/organizations`. |
| Nothing happens when you click Export | If the tab was already open when you installed or updated the extension, reload it once. The extension tries to handle this itself, but a reload always fixes it. |
| Some conversations fail in a batch | The batch continues and lists what failed at the end; the browser console has the specifics. |
| The download never appeared | Check whether Chrome blocked it, and whether the page's downloads are being sent somewhere unexpected. Bulk exports arrive as a single ZIP, so they should only ever produce one download. |

## Development

```
Claude-Conversation-Exporter/
├── manifest.json        # Extension configuration and permissions
├── background.js        # Service worker; injects content scripts into open tabs
├── content.js           # Runs on claude.ai; wires a popup message to the three below
├── content.css          # Styles for the content script
├── utils.js             # The transcript model, frontmatter, and all format renderers
├── api.js               # Every Claude.ai endpoint the extension reads, and the
│                        #   paged event-stream read behind Cowork exports
├── deliver.js           # Where a rendered file goes: download, or a batched ZIP
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

Two upstream defects are also fixed: [issue #12](https://github.com/socketteer/Claude-Conversation-Exporter/issues/12), a DOM XSS in the browse page where conversation titles were inserted into `innerHTML` unescaped, so a title like `<img src=x onerror=...>` would execute; and an overly broad `web_accessible_resources` match (`<all_urls>`, narrowed to `https://claude.ai/*`). The accent color is blue rather than upstream's purple, so it is obvious at a glance which build is loaded.

## Provenance

The fork's changes were specified and directed by Steven M. Schneider (SUNY Polytechnic Institute); the code was written by Claude Code (Anthropic) — Claude Sonnet 5 — across sessions dated 2026-07-16 through 2026-07-18, with Cowork session export and the Chrome Web Store submission material added in August 2026.

Upstream's original code was written by Claude Opus 4.1 in collaboration with a human developer. ZIP archives use [JSZip](https://stuk.github.io/jszip/).

## License

Upstream (`socketteer/Claude-Conversation-Exporter`) carries no license — no `LICENSE` file, and its README's License section is an unfilled placeholder. There is accordingly no license to inherit, and this fork is shared publicly as-is under the same unlicensed status, not under any explicit grant.

---

**Current fork:** https://github.com/StrivenWord/Claude-Interaction-Exporter
