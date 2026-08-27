---
title: "Features"
permalink: /features/
excerpt: "What Claude Interaction Exporter can do."
---

What the extension does today. Step-by-step walkthroughs live on the [Usage]({{ '/usage/' | relative_url }}) page.

## Export the conversation you're viewing

One click from the toolbar popup exports whatever is open in the tab. The extension works out whether you are on a conversation or a Cowork session and exports accordingly, so there is no mode to switch.

## Browse, search, and bulk export

A dedicated browse page lists every conversation and Cowork session in sortable, filterable tables: search by name, filter by model or Claude Project, sort by date, name, or project. Check the rows you want and click **Export Selected**, or **Export All** to take everything matching your current filters.

Selection survives changes to the filters, so you can check a few rows, search for something else, check a few more, and still have all of them. Bulk exports come back as one ZIP with an `export_summary.json` manifest, fetched in small batches to stay inside Claude.ai's rate limits, with a progress dialog you can cancel.

## Three output formats

- **Markdown** — human-readable, with YAML frontmatter and dated `<YYYY-MM-DD>-<slug>.md` filenames
- **Plain text** — a simple `Human:` / `Assistant:` transcript
- **JSON** — the complete raw data, including every branch

## Structured frontmatter

Markdown exports open with a YAML header carrying title, created and updated timestamps, model, project, contributor, tags, source URL, session ID, and Claude's own summary of the conversation. Files land in Obsidian or any other note system already organized, with no cleanup pass.

Most of those fields fill themselves in from data the API already returns. The three you control — project, contributor, and tags — can be set as defaults once and overridden per export.

## Model-aware

Claude.ai's own export does not record which model a conversation used. This extension does, and when the API reports no model at all — the default-model case — it infers one from the conversation's date rather than leaving the field empty.

## Branch-aware

Conversations you have edited and re-run branch into multiple paths. Markdown and plain text follow the branch you currently have selected; JSON keeps every branch, so nothing is lost if you archive in JSON.

## Cowork sessions and scheduled tasks

Cowork sessions and scheduled task runs export too, with their event logs replayed into a readable transcript that includes the tool activity — which searches ran, what they returned, what files were written. For a task's output, that activity *is* the provenance. Scheduled runs carry extra frontmatter (`routine`, `trigger_id`, `scheduled`, `fire_reason`), so a run triggered by a schedule stays distinguishable from one started by hand.

## No backend, no dependencies

There is no server, no account, and no third-party service. The extension requests your data from Claude.ai with the session you are already signed in to, builds the file in your browser, and hands it to you as a download. JSZip is vendored locally for ZIP archives; nothing is fetched from a remote source at runtime. See [Privacy]({{ '/privacy/' | relative_url }}).

## Not yet, or not planned

- Attachment *files* are not downloaded — an attachment appears as a reference line, plus any text Claude.ai extracted from it.
- Artifacts and a few other special content types may not render perfectly in Markdown.
- Firefox and Safari are not supported; the extension is built on Chrome's Manifest V3 APIs.

The full list of caveats is under [Known limits]({{ '/usage/#known-limits' | relative_url }}).
