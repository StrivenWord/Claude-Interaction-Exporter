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
    excerpt: "Export the conversation you're viewing straight from the toolbar popup, in Markdown, plain text, or JSON."
    url: /usage/
    btn_label: "See Usage"
    btn_class: "btn--primary"
  - title: "Browse & Bulk Export"
    excerpt: "Search, filter, and sort every conversation and Cowork session, then bulk export matches to a ZIP."
    url: /features/
    btn_label: "See Features"
    btn_class: "btn--primary"
  - title: "Frontgraph-Ready Frontmatter"
    excerpt: "Markdown exports carry structured YAML frontmatter, so files land in Obsidian or any note system already organized."
    url: /usage/#frontmatter
    btn_label: "Learn More"
    btn_class: "btn--primary"
---

{% include feature_row %}

## What it is

Claude Interaction Exporter is a Chromium browser extension that saves your own Claude.ai conversations to files on your computer. It has no backend: the extension talks to Claude.ai using the same web API the site itself uses, builds the file in your browser, and hands it to you as a download. There is no account to create, no analytics, and no third-party service in between.

## Why it exists

Claude.ai's own export tools are limited, and conversations you want to keep — research threads, coursework, project notes — tend to live only in the browser tab you had them in. This extension exists to get that content out in a form built for archiving: readable Markdown with structured frontmatter, plain text for quick pasting, or complete JSON for scripts and analysis.

It also records something Claude.ai's own export leaves out: **which model each conversation used.**

## Getting started

The extension is not in the Chrome Web Store yet, so you install it by loading its folder into your browser — about five minutes' work, and no build tools required.

1. **[Installation]({{ '/installation/' | relative_url }})** — download the ZIP or clone the repository, load the folder unpacked, and enter your organization ID once.
2. **[Usage]({{ '/usage/' | relative_url }})** — run your first export, then move on to browsing and bulk exports.

Already installed and wondering what else it does? See [Features]({{ '/features/' | relative_url }}).

## Never installed an extension this way before?

Loading an extension from GitHub is not hard, but it does ask you to make a judgement the Chrome Web Store normally makes on your behalf — and Chrome will warn you about it more than once. [**Browsers and Extensions**]({{ '/browsers-and-extensions/' | relative_url }}) is a twenty-minute primer written for exactly that moment: what a browser is actually made of, why this extension runs in Chrome and Edge but not Firefox or Safari, what the files in the folder are, and how to read the permissions an extension asks for so the decision to trust it is one you can defend.

You do not need it to follow the installation steps. It is there so that following them does not feel like guesswork.

## Status

The extension is in public beta and in active use. See the [Change Log]({{ '/changelog/' | relative_url }}) for what has shipped.

## Not affiliated with Anthropic

This is a community tool, forked from [socketteer/Claude-Conversation-Exporter](https://github.com/socketteer/Claude-Conversation-Exporter). It is not built, endorsed, or supported by Anthropic, and "Claude" is Anthropic's trademark. It exports only your own data, using the account you are already signed in to.
