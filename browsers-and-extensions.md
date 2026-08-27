---
title: "Browsers and Extensions"
permalink: /browsers-and-extensions/
excerpt: "What a browser is made of, what is inside an extension, and how to read the permissions one asks for."
---

Loading an extension from a GitHub folder asks you to make a judgement about code that nothing else has checked. This page is the background for that judgement.

The same ground is covered, hands-on, by an [interactive tutorial on Chromium extensions](https://chromium-extensions.ai.studio/) — a clickable browser blueprint, a sample extension you can take apart, a simulated `chrome://extensions` page, and a permission-auditing exercise. If you would rather click than read, start there.

What follows is the short written version, with this extension as the worked example.

## What a browser is made of

A browser is closer to a small operating system than to a window. Five of its parts matter here:

| Part | What it does |
| --- | --- |
| **Rendering engine** | Turns a page's HTML and CSS into pixels on screen. The heaviest machinery in the browser. |
| **JavaScript engine** | Runs the code a page brings with it — clicks, animations, fetching data. Chrome's is called V8. |
| **Storage** | Cookies and saved site data, plus a separate area extensions use for their own settings. |
| **Network layer** | Fetches the files a page is made of, and handles the encryption behind the padlock. |
| **Extension sandbox** | An isolated space where add-on code runs, with its own rules about what it may reach. |

That last row is the one to hold on to. An extension does not become part of Chrome; it runs walled off, and everything it is allowed to touch outside those walls has to be declared up front, in a file you can open and read. That declaration is the whole basis of the trust decision, and we read one below.

## Three engines, and why this extension is Chromium-only

There are dozens of browser brands and three rendering engines underneath them. Which engine a browser is built on decides what extensions it can run.

| Engine | By | Browsers | Extension format |
| --- | --- | --- | --- |
| **Blink** (Chromium) | Google and the Chromium project | Chrome, Edge, Brave, Opera, Vivaldi, Arc, Helium | A folder, or a packed `.crx` |
| **Gecko** | Mozilla | Firefox, Tor Browser, Waterfox, Zen | An `.xpi` package |
| **WebKit** | Apple | Safari, GNOME Web, every browser on iOS | An app bundle built in Xcode |

Blink powers roughly three quarters of desktop browsing, which is why "a Chrome extension" and "a browser extension" get treated as the same thing. They are not: the three engines expect three different packages.

So Claude Interaction Exporter loads in any Blink browser — Chrome, Edge, Brave, Opera, Vivaldi — and cannot load in Firefox or Safari at all. Not for want of testing. The file it would need to be is a different file.

The useful half of the same fact: one folder works across all the Blink browsers. If you use Edge or Brave, you do not need Chrome.

## What is inside an extension

An extension is a small bundle of the same files a website is made of — HTML, CSS, JavaScript, one JSON file — allowed to reach a little further than a website can. There are four kinds of part, and this repository has all four:

| Part | Here | What it is |
| --- | --- | --- |
| **The manifest** | `manifest.json` | The identity document: name, version, icons, and every permission requested. Chrome refuses to load a folder without one. |
| **The popup** | `popup.html`, `popup.js` | The small window that opens from the toolbar icon. |
| **Content scripts** | `content.js` | Code injected into the page you are looking at, able to read and change what is on it. |
| **The service worker** | `background.js` | Code running in the background, outside any page, listening for events. |

The rest is support: `utils.js`, the options and browse pages, `content.css`, three icons, and a local copy of JSZip. Nothing is downloaded at runtime and nothing is compiled — what is in the folder is what runs.

That is what makes "inspect the code before you trust it" a real instruction rather than a pious one. The whole thing is a handful of readable text files.

## What a store does, and what loading a folder skips

Installing from the Chrome Web Store brings four things with it: the code has been scanned and reviewed; installation is one click; Chrome patches it in the background; and Google can disable it remotely if it turns out to be malicious.

Loading a folder yourself brings none of them. That is not a flaw in Chrome's design — it is the feature that lets developers run code they are still writing — but the safeguards you are used to are simply absent.

## The three risks, stated plainly

**Nothing has scanned this code.** A folder from the internet has had no review but yours.

**An extension with page access can see what happens on that page.** This is the serious one. A content script can read the text on a site, watch what you type, and use the session you are already signed in with. Where you are logged in, that is your account — no password required.

**No one will patch it for you.** A folder never updates itself. A fix reaches you only when you go and fetch it, which makes [updating]({{ '/installation/#updating-the-extension' | relative_url }}) your job.

The principle every guide to this arrives at:

Load unpacked only code you wrote yourself, or code from an open repository whose files you have actually read. "I found it on a forum" is not an inspection.
{: .notice--danger}

That applies to this extension as much as any other. Here is how to carry it out.

## How to read a permission block

Everything an extension may reach is declared in `manifest.json`, in two fields: `permissions` for browser features, `host_permissions` for websites. Open that file first. It is short, and it is the only part you strictly have to understand.

Here is a request that should stop you — the pattern behind a great many hostile extensions, a trivial advertised purpose and access to everything:

```json
"permissions": [
  "cookies",
  "webRequest",
  "storage"
],
"host_permissions": [
  "*://*/*"
]
```

Read it as a sentence. `*://*/*` means *every site, over any protocol*. `cookies` means it may read the cookies for those sites — the tokens that keep you signed in. `webRequest` means it may watch, and potentially alter, the traffic. For something claiming to change your theme colour, each is unexplained; together they are a licence to impersonate you anywhere you are logged in.

Now this extension's:

```json
"permissions": [
  "activeTab",
  "storage",
  "scripting"
],
"host_permissions": [
  "https://claude.ai/*"
]
```

One host. Not a wildcard — a named site, over HTTPS only. Outside `claude.ai` there is nothing this extension can read or contact, and no line in the manifest that could grant it more. `activeTab` gives it the current tab's address when you click the icon, and only then. `storage` holds the four settings you type into the options page. `scripting` lets it load *its own bundled files* into a Claude.ai tab you had open before installing.

Chrome says the same thing in plainer words when you load the folder — *Read and change your data on claude.ai* — and that is the extension's entire reach. [Privacy]({{ '/privacy/' | relative_url }}) walks through each permission and its use.

Three questions to ask of any manifest:

1. **How many hosts, and are they named?** A wildcard where a specific site would do is the loudest signal there is.
2. **Does each permission have an obvious job in the thing it claims to be?** A note-taker wanting `cookies` does not.
3. **Does the code match the manifest?** Search the JavaScript for `fetch(` and see where the requests go. If the manifest names one host and the code reaches for another, the manifest is not the truth.

You can check the third here in a few minutes; the codebase is small on purpose. The history is public too — the repository names its upstream on its own front page, and every commit since is listed with its author, so you can read not just what the code says today but how it got that way.

## The warning Chrome shows at every startup

With developer mode on, Chrome greets you at each launch with a prompt offering to disable your developer-mode extensions. It will keep doing this. Dismissing it leaves your extensions running.

It is not a sign that anything is wrong, and it is not about this extension in particular: Chrome cannot tell a folder you have read through from one you grabbed off a forum, so it asks about all of them. Treat it as a standing question rather than an annoyance — you should be able to name every unpacked extension you have loaded and say why you trusted it. If the list ever holds something you do not recognise, the prompt is doing its job.

## Going further

[**Chrome for Developers: Extensions**](https://developer.chrome.com/docs/extensions) is the official documentation — the reference behind this page, and the place to start if you decide to write an extension of your own.

If any section above went past too quickly, the [interactive tutorial](https://chromium-extensions.ai.studio/) is the place to slow it down.

## Next step

You know what you are being asked to trust and how to check it. [Installation]({{ '/installation/' | relative_url }}) is the procedure.
