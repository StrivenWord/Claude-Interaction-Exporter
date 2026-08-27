---
title: "Privacy Policy"
permalink: /privacy/
excerpt: "No backend, no analytics, no third-party service."
last_modified_at: 2026-08-22
---

**Claude Interaction Exporter** — last updated 2026-08-22.

## Summary

The extension has no backend. There is no account to create, no analytics, no telemetry, and no third-party service of any kind. The only server it contacts is Claude.ai itself, to retrieve your own data; everything it reads is written to a file on your own computer. The developer never receives, sees, or stores any user data.

## What the extension handles

When you click Export, the extension requests your own data from Claude.ai's web API using the session you are already signed in to. The data retrieved may include:

- **Personal communications** — the text of your conversations with Claude, including your own messages and Claude's replies, and the event logs of your Cowork sessions and scheduled tasks.
- **Website content** — conversation titles, timestamps, model names, attachments, and hyperlinks returned by Claude.ai alongside that text.
- **Personally identifiable information** — conversations are free-form, so they may contain names, email addresses, or other identifying details that you yourself wrote or received. The extension does not seek out this information, index it, or treat it differently from any other text.

This data is converted to Markdown, plain text, or JSON and saved to your computer as a download. It is not transmitted anywhere else.

## What the extension stores

The extension saves four settings you enter in its own interface: your Claude.ai organization ID, and optional defaults for a project key, a contributor name, and a tag list. These are stored using Chrome's extension storage.

No conversation content is ever stored by the extension. Nothing is cached between exports.

## Credentials

The extension does not read, store, or transmit passwords, cookies, or session tokens. Requests to Claude.ai are made with the browser's existing session, which the browser attaches on its own — the same way the Claude.ai website does. The extension has no access to the credential's contents.

## Permissions

| Requested | Used for |
| --- | --- |
| `https://claude.ai/*` | Reading your own conversations and sessions from Claude.ai's API. claude.ai is the only site the extension can access or contact. |
| `activeTab` | Reading the URL of the current tab when you click the toolbar icon, to identify which conversation or session to export. Granted on click, for that one tab; no browsing history is enumerated or stored. |
| `storage` | Saving the four settings described above. |
| `scripting` | Loading the extension's own bundled files into Claude.ai tabs that were already open when it was installed or updated. Nothing is fetched or evaluated from outside the extension. |

Within those declarations:

- No host other than `claude.ai` is listed in the manifest, so no other site can be read or contacted.
- No data is sent to the developer or a third party.
- Nothing is fetched until you click a button.
- Every request the extension makes is a read; no conversation is modified or deleted.

## Two things to know about your exports

**Exported files are plain, unencrypted text**, as readable as any other document once they are on disk. Worth remembering if you sync them to a shared drive or commit them to a public repository.

**The four settings use Chrome's syncing storage.** With Chrome Sync on, those four values — including a contributor name, which may be your real name — travel between your own signed-in browsers by way of Google, the same way bookmarks do. This is handled by Chrome itself and is not visible to the developer. Conversation content is never stored this way.
{: .notice--info}

## Data use commitments

- User data is never sold or transferred to any third party.
- User data is never used or transferred for any purpose unrelated to the extension's single purpose of exporting your own conversations.
- User data is never used or transferred to determine creditworthiness or for lending purposes.

## Changes

Any material change to this policy will be published here with an updated date.

## Contact

Questions about this policy: [open an issue](https://github.com/StrivenWord/Claude-Interaction-Exporter/issues) on the repository.

---

*This page mirrors [`PRIVACY.md`](https://github.com/StrivenWord/Claude-Interaction-Exporter/blob/main/PRIVACY.md) in the repository, which is the canonical text.*
