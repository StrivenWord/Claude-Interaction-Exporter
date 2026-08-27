---
title: "Browsers and Extensions"
permalink: /browsers-and-extensions/
excerpt: "What a browser actually is, what an extension is made of, and why installing one from GitHub asks something of you that the Chrome Web Store does not."
---

You do not need this page to install the extension. [Installation]({{ '/installation/' | relative_url }}) is a procedure you can follow without it.

You may want it anyway. Installing an extension from the Chrome Web Store is a single click because Google has already done some work on your behalf — reviewing the code, scanning it, and promising to keep it patched. Installing one from GitHub skips all of that, and Chrome will tell you so, repeatedly, in language designed to make you hesitate. That hesitation is well founded. This page explains what the warnings are about, so that when you decide to go ahead, the decision is actually yours.

Twenty minutes here, and the rest of the process stops feeling like an act of faith.

## What a browser actually is

It is tempting to think of a browser as a window onto the internet. It is closer to a small operating system, and it helps to know which of its parts an extension gets to touch.

| Part | What it does |
| --- | --- |
| **Rendering engine** | Reads a page's HTML structure, applies its CSS style rules, works out where every pixel belongs, and draws the result. The heaviest machinery in the browser. |
| **JavaScript engine** | Runs the code a page brings with it — the part that responds to clicks, animates things, and fetches data while you sit on the page. Chrome's is called V8. |
| **Storage** | Cookies, saved site data, and a separate area extensions can use for their own settings. |
| **Network layer** | Fetches the files a page is made of, and handles the encryption behind the padlock in the address bar. |
| **Extension sandbox** | An isolated space where add-on code runs, with its own rules about what it may and may not reach. |

That last row is the one that matters here. An extension does not become part of Chrome. It runs in a walled-off area, and everything it is allowed to do outside that area — every site it may read, every browser feature it may use — has to be declared up front, in writing, in a file you can open and read. The declaration is the whole basis of the trust decision, and later on this page we will read one.

If an analogy helps: the rendering engine is a cook working from a recipe, HTML is the ingredients list, CSS is how the dish is plated, and JavaScript is everything that happens on the stove. An extension is a second cook you have invited into the kitchen. Useful, and worth knowing what you have handed them the keys to.

## Three engines, and why this extension is Chromium-only

There are dozens of browser brands and essentially three rendering engines underneath them. Which engine a browser is built on decides what extensions it can run.

| Engine | Maintained by | Browsers | Extension format |
| --- | --- | --- | --- |
| **Blink** (Chromium) | Google and the Chromium project | Chrome, Edge, Brave, Opera, Vivaldi, Arc, Helium | Chrome extension — a folder, or a packed `.crx` |
| **Gecko** | Mozilla | Firefox, Tor Browser, Waterfox, Zen | Firefox add-on — an `.xpi` package |
| **WebKit** | Apple | Safari, GNOME Web, and every browser on iOS | Safari web extension — an app bundle built in Xcode |

Blink powers something like three quarters of desktop browsing, which is why "a Chrome extension" and "a browser extension" are so often treated as the same thing. They are not. The three engines expect three different packages, built and signed three different ways.

This is the real reason behind the one-line note on the installation page: Claude Interaction Exporter is written against Chromium's extension APIs, so it will load in any Blink-based browser — Chrome, Edge, Brave, Opera, Vivaldi — and cannot be loaded in Firefox or Safari at all. Not because it has not been tested there. Because the file it would need to be is a different file.

The flip side is the useful part: because those browsers share a core, one folder works across all of them. If you already use Edge or Brave, you do not need Chrome.

## What is inside an extension

An extension is not a mysterious binary. It is a small bundle of the same files any website is made of — HTML, CSS, JavaScript, and one JSON file — with permission to reach a little further than a website can. There are four kinds of part, and you can see all of them in this repository:

| Part | In this extension | What it is |
| --- | --- | --- |
| **The manifest** | `manifest.json` | The identity document. Name, version, icon, and — the important part — every permission the extension is asking for. Required in every extension; Chrome refuses to load a folder without one. |
| **The popup** | `popup.html`, `popup.js` | The little window that opens when you click the toolbar icon. Ordinary HTML and JavaScript. |
| **Content scripts** | `content.js` | Code injected into a page you are looking at, able to read and change what is on it. The part with its hands on the document. |
| **The service worker** | `background.js` | Code that runs in the background, outside any page, listening for events — a click on the icon, a download finishing. |

Everything else is support: `utils.js` for shared helpers, `options.html` and `options.js` for the settings page, `browse.html` and `browse.js` for the browse-and-bulk-export page, `content.css` for the styles the content script adds, three icon files, and a local copy of JSZip for building ZIP archives. Nothing is downloaded at runtime and nothing is compiled. What you see in the folder is what runs.

Knowing this is what makes the folder legible when you open it. It is also what makes "inspect the code before you trust it" a real instruction rather than a pious one — the whole thing is a handful of readable text files.

## What the Chrome Web Store does, and what loading unpacked skips

When you install from the Web Store, four things come with it:

- **Review.** The code is submitted, scanned automatically for malware, and — depending on what it asks for — looked at by a human.
- **One click.** No folder, no file picker, no path to keep track of.
- **Automatic updates.** Chrome checks for new versions in the background and installs security fixes without asking you.
- **Revocation.** If an extension is later found to be malicious, Google can pull it and disable existing installs.

Loading an unpacked folder skips all four. That is not a bug in Chrome's design; it is the feature that lets developers run code they are still writing. But it means the safeguards you are used to are simply absent, and Chrome is right to say so.

## The three risks, stated plainly

Chrome's warnings about developer mode come down to three things.

**Nothing has scanned this code.** A folder from the internet has not been through any store's malware or privacy review. The only review it has had is whatever you give it.

**An extension with page access can read what happens on that page.** This is the serious one. Code running as a content script on a site can see the text on it, watch what you type, and use the session you are already signed in with. On a site where you are logged in, that is your account. A malicious extension does not need your password to act as you; it only needs to be running where you are signed in.

**No one will patch it for you.** An unpacked folder never updates itself. If a flaw is found in it, or in something it bundles, the fix reaches you only when you go and fetch it. That makes [updating]({{ '/installation/#updating-the-extension' | relative_url }}) your job, not Chrome's.

The principle that follows is the one every guide to this arrives at:

Load unpacked only code you wrote yourself, or code from an open repository whose files you have actually looked at. "I found it on a forum" and "it had a nice website" are not inspections.
{: .notice--danger}

That applies to this extension as much as any other. What follows is how to carry it out here — and the skill transfers to the next extension you are offered.

## How to read a permission block

Everything an extension may reach is declared in `manifest.json`, in two fields: `permissions`, for browser features, and `host_permissions`, for websites. Open that file first, before anything else. It is short, and it is the only part you strictly have to understand.

Here is a request that should stop you. It is the pattern behind a great many hostile extensions — a trivial advertised purpose, and access to everything:

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

Read it as a sentence. `*://*/*` means *every site, over any protocol*. `cookies` means it may read the cookies for those sites — the tokens that keep you signed in. `webRequest` means it may watch, and potentially alter, the traffic between you and them. For something claiming to change your theme colour, each of those is unexplained, and together they are a licence to impersonate you anywhere you are logged in.

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

One host. Not a wildcard — a named site, over HTTPS only. Outside `claude.ai` there is nothing this extension can read or contact, and no line in the manifest that could grant it more. `activeTab` gives it the current tab's address when you click the icon, and only then. `storage` is for the four settings you type into the options page. `scripting` lets it load *its own bundled files* into a Claude.ai tab you had already opened before installing.

Chrome will show you the same thing in plainer words when you load the folder — *Read and change your data on claude.ai* — and that is the extension's entire reach. The [Privacy]({{ '/privacy/' | relative_url }}) page walks through each permission and what it is used for.

Three questions to ask of any manifest:

1. **How many hosts, and are they named?** A wildcard where a specific site would do is the single loudest signal.
2. **Does each permission have an obvious job in the thing it claims to be?** A note-taker wanting `cookies` does not.
3. **Does the code match the manifest?** Search the JavaScript for `fetch(` and see where the requests go. If the manifest says one host and the code reaches for another, the manifest is not the truth.

For this extension you can check the third yourself in a few minutes; the codebase is small on purpose. Its history is public too — the repository is a fork, it names its upstream on its own front page, and every commit since is listed with its author, so you can read not just what the code says today but how it got that way.

## The warning Chrome shows at every startup

Once developer mode is on, Chrome greets you at each launch with a prompt offering to disable your developer-mode extensions. It will keep doing this. It is not a sign that anything is wrong, and it is not specific to this extension — Chrome has no way to tell a carefully reviewed folder from a reckless one, so it asks about all of them, every time.

Dismissing it leaves your extensions running. But treat it as a standing question rather than an annoyance to click past: it is worth being able to name every unpacked extension you have loaded and say why you trusted it. If the list has grown to include something you no longer recognise, that is the prompt doing its job.

## Going further

[**An interactive tutorial on Chromium extensions**](https://chromium-extensions.ai.studio/) covers this same ground hands-on, with a clickable browser blueprint, a dissection of a working sample extension, a simulated `chrome://extensions` page, and a permission-auditing exercise. If any section above went past too quickly, that is the place to slow it down.

[**Chrome for Developers: Extensions**](https://developer.chrome.com/docs/extensions) is the official documentation — the reference behind everything on this page, and the place to go if you decide you would like to write one of your own.

## Next step

You know what you are being asked to trust and how to check it. [Installation]({{ '/installation/' | relative_url }}) is the procedure.
