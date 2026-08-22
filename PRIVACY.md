# Privacy Policy

**Conversation Frontgraph Exporter**
Last updated: 2026-08-22

## Summary

The extension has no backend. There is no account to create, no analytics, no telemetry, and no third-party service of any kind. The only server it contacts is Claude.ai itself, to retrieve your own data; everything it reads is written to a file on your own computer. The developer never receives, sees, or stores any user data.

## What the extension handles

When you click Export, the extension requests your own data from Claude.ai's web API using the session you are already signed in to. The data retrieved may include:

- **Personal communications** — the text of your conversations with Claude, including your own messages and Claude's replies, and the event logs of your Cowork sessions and scheduled tasks.
- **Website content** — conversation titles, timestamps, model names, attachments, and hyperlinks returned by Claude.ai alongside that text.
- **Personally identifiable information** — conversations are free-form, so they may contain names, email addresses, or other identifying details that you yourself wrote or received. The extension does not seek out this information, index it, or treat it differently from any other text.

This data is converted to Markdown, plain text, or JSON and saved to your computer as a download. It is not transmitted anywhere else.

## What the extension stores

The extension saves four settings you enter in its own interface: your Claude.ai organization ID, and optional defaults for a project key, a contributor name, and a tag list. These are stored using Chrome's extension storage. If you have Chrome Sync enabled, Chrome may sync these four settings across your own signed-in devices; this is handled by Chrome itself and is not visible to the developer.

No conversation content is ever stored by the extension. Nothing is cached between exports.

## Credentials

The extension does not read, store, or transmit passwords, cookies, or session tokens. Requests to Claude.ai are made with the browser's existing session, which the browser attaches on its own — the same way the Claude.ai website does. The extension has no access to the credential's contents.

## Permissions

- **claude.ai access** — required to read your own conversations and sessions from Claude.ai's API. claude.ai is the only site the extension can access or contact.
- **activeTab** — reads the URL of the current tab when you click the toolbar icon, to identify which conversation or session to export.
- **storage** — saves the four settings described above.
- **scripting** — loads the extension's own bundled files into Claude.ai tabs that were already open when the extension was installed or updated.

## Data use commitments

- User data is never sold or transferred to any third party.
- User data is never used or transferred for any purpose unrelated to the extension's single purpose of exporting your own conversations.
- User data is never used or transferred to determine creditworthiness or for lending purposes.

## Changes

Any material change to this policy will be published here with an updated date.

## Contact

Questions about this policy: open an issue at
<https://github.com/stevesunypoly/Claude-Conversation-Exporter/issues>.
