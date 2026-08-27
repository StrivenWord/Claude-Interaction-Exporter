---
layout: splash
title: "Claude Interaction Exporter"
excerpt: "Save your own Claude.ai conversations, Cowork sessions, and scheduled tasks to files on your computer — Markdown, plain text, or JSON."
toc: false
header:
  overlay_color: "#000"
  overlay_filter: "0.5"
  actions:
    - label: "Get Started"
      url: /installation/
    - label: "View on GitHub"
      url: "https://github.com/StrivenWord/Claude-Interaction-Exporter"
feature_row:
  - title: "One-Click Export"
    excerpt: "Export the conversation you're viewing straight from the toolbar popup, in Markdown with structured frontmatter, plain text, or JSON."
    url: /usage/
    btn_label: "See Usage"
    btn_class: "btn--primary"
  - title: "New to Browser Extensions?"
    excerpt: "An interactive tutorial on how Chromium extensions work, what developer mode is, and how to judge an extension before you install it."
    url: "https://chromium-extensions.ai.studio/"
    btn_label: "Open the Tutorial"
    btn_class: "btn--primary"
  - title: "Browse & Bulk Export"
    excerpt: "Search, filter, and sort every conversation and Cowork session, then bulk export everything that matches to a ZIP."
    url: /features/
    btn_label: "See Features"
    btn_class: "btn--primary"
---

{% include feature_row %}

## What it is

Claude Interaction Exporter is a Chromium browser extension that saves your own Claude.ai conversations to files on your computer. It works entirely between your browser and Claude.ai: the extension asks for your conversations using the account you are already signed in to, builds the file inside your browser, and hands it to you as a download. Claude.ai is the only site it is permitted to contact, so nothing reaches the developer or any other service — there is no account to create and no analytics.

## Why it exists

Claude.ai's own export tools are limited, and conversations you want to keep — research threads, coursework, project notes — tend to live only in the browser tab you had them in. This extension exists to get that content out in a form built for archiving: readable Markdown with structured frontmatter, plain text for quick pasting, or complete JSON for scripts and analysis.

It also records something Claude.ai's own export leaves out: **which model each conversation used.**

## Getting started

The extension is not published to the Chrome Web Store at this time, so you install it by loading its folder into your browser — about five minutes' work, and no build tools required.

1. **[Installation]({{ '/installation/' | relative_url }})** — download the ZIP or clone the repository, load the folder unpacked, and enter your organization ID once.
2. **[Usage]({{ '/usage/' | relative_url }})** — run your first export, then move on to browsing and bulk exports.

Already installed and wondering what else it does? See [Features]({{ '/features/' | relative_url }}).

## Never installed an extension this way before?

Two places to start, covering the same ground:

- [**The interactive tutorial**](https://chromium-extensions.ai.studio/) — hands-on, with a clickable browser blueprint, a sample extension to take apart, and a permission-auditing exercise.
- [**Browsers and Extensions**]({{ '/browsers-and-extensions/' | relative_url }}) — the short written version, using this extension as the worked example.

Either one answers the questions the installation steps assume: what an extension actually is, why this one runs in Chrome and Edge but not Firefox or Safari, and how to read the permissions an extension asks for before you agree to them.

## Status

The extension is in public beta and in active use. See the [Change Log]({{ '/changelog/' | relative_url }}) for what has shipped.

## Not affiliated with Anthropic

This is a community tool, forked from [socketteer/Claude-Conversation-Exporter](https://github.com/socketteer/Claude-Conversation-Exporter). It is not built, endorsed, or supported by Anthropic, and "Claude" is Anthropic's trademark. It exports only your own data, using the account you are already signed in to.
