---
title: "Change Log"
permalink: /changelog/
excerpt: "What's new in Claude Interaction Exporter."
---

Notable changes to the extension, newest first. The version currently loaded in your browser is printed in small print at the bottom of the toolbar popup and at the top right of the browse page.

## Since 1.5.3

- Renamed from *Claude Conversation Exporter* to **Claude Interaction Exporter**, since it now exports Cowork sessions and scheduled tasks as well as chat conversations.
- This documentation site.

## 1.5.3 — 2026-08-21

- The **scheduled runs only** checkbox now filters the task table itself, not just the bulk export. Because Claude.ai's session list does not say whether a session was scheduled, checking the box does visible work the first time: sessions are examined and the ones that were not scheduled drop out.
- The box starts unchecked, so a fresh browse page shows everything it already knows without waiting.

## 1.5.2 — 2026-08-21

- **Export Cowork sessions and scheduled tasks.** Tasks run as Cowork sessions rather than chat conversations, so they are read from a different pair of endpoints and their event log is replayed into a readable transcript — including the tool activity, which is the provenance of a task's result. Exported tasks keep the same shape as exported conversations, with `type: task`, `source: claude-cowork`, and scheduling fields in the frontmatter.
- The browse page lists sessions alongside conversations, with their own **Export All Tasks** button.
- **Per-export tags now reach the exported files.** The field was wired into the popup but never read on the way out. Input is cleaned rather than rejected: a leading `#` comes off, spaces become hyphens, characters Obsidian will not accept are dropped, and duplicates collapse.
- Fixed a developer-mode annoyance where reloading the extension left a Claude.ai tab running a mix of old and new code.
- Conversation exports are unchanged, verified byte for byte against the previous version.

## 1.4.1 — 2026-07-18

- **Security:** patched a DOM XSS inherited from upstream ([issue #12](https://github.com/socketteer/Claude-Conversation-Exporter/issues/12)), where conversation titles were inserted into the browse page's `innerHTML` unescaped — so a title containing markup would execute.
- Narrowed an overly broad `web_accessible_resources` match from `<all_urls>` to `https://claude.ai/*`.
- Changed the accent color, so it is obvious at a glance which build is loaded.

## 1.4.0 — 2026-07-17

The first release of this fork's own features, on top of [socketteer/Claude-Conversation-Exporter](https://github.com/socketteer/Claude-Conversation-Exporter).

- **YAML frontmatter on Markdown exports**, plus dated `<YYYY-MM-DD>-<slug>.md` filenames and per-export tags.
- **Project filter, sort, and column on the browse page**, matching the existing model filter. Conversations in no project group under a "No Project" bucket so they stay filterable.
- **Checkbox selection with an Export Selected button.** Selection is tracked independently of the filters, so checking some rows, changing the search, and checking more does not lose the earlier picks.
- **Model information is preserved.** Claude.ai's own export does not record which model a conversation used; this one does, and infers the model from the conversation's date when the API reports none.
