---
title: "Usage"
permalink: /usage/
excerpt: "Export the conversation you're viewing, or browse and bulk export everything."
---

This page assumes the extension is loaded and your organization ID is saved. If not, start with [Installation]({{ '/installation/' | relative_url }}).

There are two ways to export: the **toolbar popup**, for the conversation in front of you, and the **browse page**, for finding and exporting many at once.

## Export the conversation you're viewing

1. Open a conversation (`claude.ai/chat/…`) or a Cowork session (`claude.ai/cowork/…`).
2. Click the extension icon in the toolbar.
3. Choose a format — **Markdown**, **Plain text**, or **JSON**.
4. Optionally fill in **project**, **contributor**, and **tags** for this export.
5. Click **Export Current Conversation**.

The file lands in your browser's downloads. The extension detects whether you are on a conversation or a Cowork session and exports accordingly, so there is nothing to switch between the two.

If the tab was already open when you installed or updated the extension, reload it once before your first export.
{: .notice--info}

## Browse and bulk export

Click the extension icon → **Browse All Conversations**. The browse page lists your conversations and your Cowork sessions in two separate tables, where you can:

- **Search** by name, and **filter** by model or by Claude Project
- **Sort** by created date, updated date, name, or project
- **Check individual rows** and click **Export Selected**
- Click **Export All** to export every conversation matching your current filters
- Limit the task table to scheduled runs only

Selection is tracked independently of the filters. You can check a few rows, change the search, check a few more, and the earlier picks are still there.

**Export All** and **Export Selected** act on the conversation table. The task table has its own **Export All Tasks** button, which exports the sessions it is currently listing.

### What a bulk export produces

Bulk exports arrive as a single ZIP containing an `export_summary.json` manifest, with task exports filed under a `tasks/` folder. Conversations are fetched three at a time with a pause between batches, to stay well inside Claude.ai's rate limits — so a large export can take several minutes. A progress dialog tracks the run and can cancel it, and anything that fails to fetch is listed at the end rather than aborting the whole batch.

The popup also has an **Export All Conversations** button, which behaves differently and is not the one you want for real bulk work. In Markdown or plain text it downloads one file per conversation, which makes Chrome ask you to allow multiple downloads. In JSON it writes a single combined file built from the conversation-list endpoint, so the file carries titles and metadata but **no message history**. For bulk exports, and for complete JSON, use the browse page.
{: .notice--warning}

## Output formats

| Format | What you get | Best for |
| --- | --- | --- |
| **Markdown** | Human-readable, with YAML frontmatter. Current branch only. | Obsidian, note-taking, coursework, writing |
| **Plain text** | `Human:` / `Assistant:` prefixes, shortened to `H:` / `A:` after the first exchange. Current branch only. | Pasting into another tool or a text editor |
| **JSON** | The complete raw data, including every branch and all metadata. | Archiving, scripts, data analysis |

Markdown files are named `<YYYY-MM-DD>-<slug>.md`, so a folder of exports sorts chronologically on its own.

### The "Include metadata" checkbox

Present in both the popup and the browse page, this controls how much detail goes *inside* the file: per-message timestamps, attachment lists, the header block above the transcript, and — in Markdown exports of Cowork sessions — the tool-call and tool-result blocks. YAML frontmatter is written either way.

## Frontmatter

Every Markdown export opens with a structured YAML header, which is what lets exported files land in a note system already organized:

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

Most of it is filled in for you. `title`, `date`, `created`, `updated`, `source_url`, `model`, `session_id`, and `summary` all come from data Claude.ai's API already returns — including the per-conversation summary Claude writes itself. `project` auto-fills from the conversation's Claude Project name and falls back to the literal `None`; whatever you type in the project field overrides either. `contributor` and `tags` come entirely from you.

Cowork sessions and scheduled tasks use `type: task` and `source: claude-cowork`, and add `routine`, `trigger_id`, `scheduled`, and `fire_reason` — so a run started by a schedule stays distinguishable from one you kicked off by hand.

### Tags

Tags are per-export: type a comma-separated list, and every file in that export carries it. Input is cleaned rather than rejected — a leading `#` is stripped, tags are lowercased, spaces inside a tag become hyphens, characters outside the set Obsidian accepts (letters, digits, `_`, `-`, `/`) are dropped, and duplicates collapse. Markdown gets a YAML block sequence, JSON gets a `tags` array, and plain text gets a `Tags:` line.

The Options page sets the field's *starting* value; editing tags for one export never overwrites that default.

### Where defaults are written back

One asymmetry is worth knowing if you use the Options-page defaults. Editing **project** or **contributor** on the browse page saves the new value back as your default. Editing **tags** there does not — a one-off tag list never becomes permanent. The popup writes none of the three back.

## What the extension can access

`manifest.json` requests access to one website and three browser capabilities. Only the website access raises a warning at install time.

| Requested | Used for |
| --- | --- |
| `https://claude.ai/*` | Reading your conversations and sessions from Claude.ai's API. It is the only host in the manifest and the only host contacted. |
| `activeTab` | Reading the address of the current tab when you click the icon, to identify which conversation to export. Granted on click, for that one tab. |
| `storage` | Saving the four settings you enter: organization ID, and default project, contributor, and tags. |
| `scripting` | Loading the extension's own two bundled files into Claude.ai tabs that were already open when it was installed or updated, so the first export works without a manual reload. |

Every request the extension makes is a read; no conversation is modified or deleted, and nothing is fetched until you click a button. The [Privacy]({{ '/privacy/' | relative_url }}) page has the full account.

## Known limits

- Markdown and plain text export only the currently selected branch of a multi-branch conversation. Use JSON for every branch.
- Large bulk exports take time: the browse page fetches three conversations at a time with a pause between batches; the popup's Export All fetches them one at a time.
- Plain-text exports of Cowork sessions carry the prose only. Tool activity appears in the Markdown and JSON forms.
- Some special content types, artifacts in particular, may not render perfectly in Markdown.
- Attachment *files* are not downloaded. An attachment appears as a reference line with its name, size, and type; if Claude.ai extracted text from it, that text is included, but the original file is not.
- An individual conversation can occasionally fail to fetch or parse. A batch skips it and reports it at the end rather than aborting.

## If an export fails

| Symptom | Fix |
| --- | --- |
| "Organization ID not configured" | Enter it on the Options page — see [Installation]({{ '/installation/#stage-3-connect-your-claudeai-account' | relative_url }}). |
| "Not authenticated" | Sign in to Claude.ai, reload the page, and try again. |
| "Access denied" | Your saved organization ID probably belongs to a different organization than the conversations you are exporting. |
| Nothing happens when you click Export | Reload the Claude.ai tab once, then retry. |
| Some conversations fail in a batch | The batch continues and lists what failed at the end; your browser's console has the specifics. |
| The download never appeared | Chrome may be blocking multiple automatic downloads. Bulk-export from the browse page instead, which produces a single ZIP. |
