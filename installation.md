---
title: "Installation"
permalink: /installation/
excerpt: "Get the extension's files, load them into your browser, and connect it to your Claude.ai account."
---

You install Claude Interaction Exporter from its own folder: put the extension's files somewhere on your computer, turn on developer mode in your browser, and point the browser at that folder. This is called **loading unpacked**, and it takes about five minutes.

There are three stages:

1. **Get the files** — download a ZIP archive and unpack it, or clone the repository with Git.
2. **Load the folder** into your browser from the extensions page.
3. **Connect your Claude.ai account** by entering your organization ID once.

**Prerequisites:** Chrome, or another Chromium-based browser (Edge, Brave, Opera, Vivaldi), and a Claude.ai account you can sign in to. There is no build step and nothing to install — no Node.js, no `npm install`, no compiler. The extension runs from the files exactly as they come out of the repository.
{: .notice--info}

Firefox and Safari cannot run this extension. They are built on different rendering engines, which expect a differently packaged add-on — an `.xpi` for Firefox, an Xcode app bundle for Safari — so this is not a matter of testing but of format. [Browsers and Extensions]({{ '/browsers-and-extensions/' | relative_url }}) explains why.
{: .notice--warning}

If terms like *extension*, *unpacked*, or *developer mode* are new to you, [Browsers and Extensions]({{ '/browsers-and-extensions/' | relative_url }}) covers them, and so does the [interactive tutorial](https://chromium-extensions.ai.studio/) it is based on.

## Before you start: What loading unpacked means

Two things follow from installing an extension this way, and Chrome will warn you about both.

**Nothing has checked this code but you.** No scanner, no reviewer, no store.

**Nothing will update it but you.** A folder does not patch itself, and Chrome will not tell you a new version exists.

Hence the rule everyone who works with extensions settles on: load unpacked only code you wrote, or code from an open repository whose files you have read.
{: .notice--danger}

You are entitled to hold this extension to that. It is set up so you can:

- **Read the manifest.** [`manifest.json`](https://github.com/StrivenWord/Claude-Interaction-Exporter/blob/main/manifest.json) declares everything the extension may reach. Its `host_permissions` names exactly one site, `https://claude.ai/*`, with no wildcard.
- **Read the code.** A dozen or so plain JavaScript, HTML, and CSS files, none minified, none compiled. Searching them for `fetch(` shows every request the extension makes and where it goes.
- **Read the history.** The repository is public, and every commit is listed with its author.
- **Check the claims.** [Privacy]({{ '/privacy/' | relative_url }}) sets out each permission and its use, mirroring [`PRIVACY.md`](https://github.com/StrivenWord/Claude-Interaction-Exporter/blob/main/PRIVACY.md) in the repository.

[How to read a permission block]({{ '/browsers-and-extensions/#how-to-read-a-permission-block' | relative_url }}) walks through what to look for, putting this extension's manifest next to a hostile one — a skill worth having the next time something asks you to load a folder.

## Stage 1: Get the files

Both methods produce the same files. The difference is how you get updates later.

| | Download the ZIP | Clone with Git |
| --- | --- | --- |
| Needs | Nothing but a browser | Git installed |
| Updating | Download and unpack again | `git pull` in the folder |
| Best for | Everyone else | Anyone who already uses Git |

### Option A: Download and unpack the ZIP archive

GitHub will hand you the whole repository as a single ZIP archive. No account, no tools.

**1. Open the repository** at [github.com/StrivenWord/Claude-Interaction-Exporter](https://github.com/StrivenWord/Claude-Interaction-Exporter).

**2. Click the green Code button,** above the file list and to the right of the search box.

{% include figure image_path="/assets/images/install/github-code-button.png" alt="The GitHub page for the Claude-Interaction-Exporter repository, with the green Code button above the file list circled." caption="The green **Code** button opens the menu of ways to get the code onto your computer. The yellow banner and the **Contribute** and **Sync fork** buttons are for people editing the project — ignore them." %}

**3. Click Download ZIP,** the last item in the menu that drops down.

{% include figure image_path="/assets/images/install/github-download-zip.png" alt="The opened Code menu, showing the Clone box with HTTPS, SSH and GitHub CLI tabs, then Open in GitHub Copilot app, Open with GitHub Desktop, and Download ZIP at the bottom, with an arrow pointing to Download ZIP." caption="Everything above **Download ZIP** — the **Clone** box with its HTTPS, SSH, and GitHub CLI tabs, and the GitHub Desktop and Copilot entries — is for other ways of getting the code. Walk past it." %}

The top of that menu is where people get stuck. The **Clone** box, and which of HTTPS, SSH, or GitHub CLI happens to be selected in it, only matters if you are cloning — Option B below.
{: .notice--info}

**4. Find the downloaded file.** Your browser saves `Claude-Interaction-Exporter-main.zip`, normally to Downloads. The `-main` suffix is the name of the repository's main branch, not a version number.

**5. Move the ZIP somewhere you intend to keep** — `Documents`, for instance — before unpacking. The folder you unpack has to stay put permanently; see the warning below.

**6. Unpack it.**

- **macOS** — double-click the ZIP. Archive Utility unpacks it beside the archive, leaving a folder named `Claude-Interaction-Exporter-main`.
- **Windows** — right-click the ZIP and choose **Extract All…**, then confirm the destination and click **Extract**. Do not just double-click it: that opens a read-only preview window that *looks* like a folder, and Chrome cannot load an extension from it.
- **Linux** — `unzip Claude-Interaction-Exporter-main.zip`, or **Extract Here** in your file manager.

**7. Open the resulting folder** and check that `manifest.json` sits directly inside it, not one level deeper.

Some extractors nest the contents, leaving you with `Claude-Interaction-Exporter-main/Claude-Interaction-Exporter-main/manifest.json`. If that happens, the folder you want next is the inner one — the one that directly contains `manifest.json`.
{: .notice--info}

### Option B: Clone the repository with Git

Cloning makes a full copy of the repository, history included, so updating later is a single command.

First check that Git is installed. Open a terminal — **Terminal** on macOS or Linux, **Command Prompt**, **PowerShell**, or **Git Bash** on Windows — and run:

```bash
git --version
```

If that prints a version number, you have Git. If the command is not found, install it from [git-scm.com/downloads](https://git-scm.com/downloads) and open a new terminal afterward.

Now move to wherever you keep projects and clone:

```bash
cd ~/Documents
git clone https://github.com/StrivenWord/Claude-Interaction-Exporter.git
```

That creates a folder named `Claude-Interaction-Exporter` inside `~/Documents`. On Windows, use a path such as `cd %USERPROFILE%\Documents` instead.

That command is the HTTPS form, which works without setting anything up. The **SSH** and **GitHub CLI** tabs in GitHub's Clone box offer the same repository by other routes; both want credentials configured first, and neither gives you anything extra here.
{: .notice--info}

To update later, run `git pull` in that folder and reload the extension — see [Updating the extension](#updating-the-extension).

### What should be in the folder

There is no build output and nothing hidden. These files *are* the extension.

| | |
| --- | --- |
| `manifest.json` | The identity document — name, version, icons, and every permission requested. Chrome refuses to load a folder without it. |
| `popup.html`, `popup.js` | The small window that opens from the toolbar icon. |
| `content.js`, `content.css` | The part that runs inside Claude.ai pages. |
| `background.js` | The service worker, listening for events in the background. |
| `browse.html`, `browse.js` | The browse-and-bulk-export page. |
| `options.html`, `options.js` | The settings page, where the organization ID goes. |
| `utils.js`, `jszip.min.js` | Shared helpers, and a local copy of JSZip for building ZIP archives. |
| `icon16.png`, `icon48.png`, `icon128.png` | The toolbar and extensions-page icons. |

Why an extension is built out of these parts is covered under [What is inside an extension]({{ '/browsers-and-extensions/#what-is-inside-an-extension' | relative_url }}).

The one thing to confirm before moving on: `manifest.json` is *directly* inside the folder you are looking at. That is the folder Chrome needs.

### Keep the folder where you put it

Chrome does not copy an unpacked extension into itself. It records the path to your folder and reads the files from that path every time the browser starts. Delete, move, or rename the folder later and the extension breaks, reported as missing or corrupted.

Put the folder somewhere permanent before loading it, and leave it there. Downloads and Desktop are risky, especially with macOS's "Optimize Storage" or any tool that periodically empties Downloads.
{: .notice--danger}

## Stage 2: Load the extension into your browser

1. Open a new tab and go to `chrome://extensions/`. Typing that address beats hunting through menus; on Edge it is `edge://extensions/`, on Brave `brave://extensions/`.
2. Turn on **Developer mode** with the toggle at the top right. Three buttons appear — **Load unpacked**, **Pack extension**, **Update**.
3. Click **Load unpacked**.
4. In the file picker, select the folder that directly contains `manifest.json` — `Claude-Interaction-Exporter-main` if you unpacked the ZIP, `Claude-Interaction-Exporter` if you cloned. Select the *folder itself*; do not open it and select `manifest.json`.
5. A card titled **Claude Interaction Exporter** appears on the extensions page. That is it — the extension is installed.
6. Pin it to the toolbar so it is one click away: click the puzzle-piece icon at the right of the address bar, find the extension, and click the pin beside its name.

Chrome will ask you to approve one permission: *Read and change your data on claude.ai.* That is the extension's only host permission, and claude.ai is the only site it can reach. [Privacy]({{ '/privacy/' | relative_url }}) explains each permission and why it is requested.

### The warning Chrome will keep showing you

With developer mode on, Chrome greets you at every startup with a prompt offering to disable your developer-mode extensions. Dismissing it leaves this extension working, and the prompt will be back next time.

It is not a fault, and it is not about this extension in particular: Chrome cannot tell a folder you have read through from one you grabbed off a forum, so it asks about all of them. Treat it as a standing question — you should be able to name every unpacked extension you have loaded and say why you trusted it. More under [The warning Chrome shows at every startup]({{ '/browsers-and-extensions/#the-warning-chrome-shows-at-every-startup' | relative_url }}).

### Confirm which build is loaded

The extension's version is in small print at the bottom of the toolbar popup and at the top right of the browse page — for example `1.5.3 — 2026-08-21`. After any update, check that line to be sure the reload took effect.

## Stage 3: Connect your Claude.ai account

The extension asks Claude.ai's API for your conversations, and the address of that API includes your **organization ID**. Claude.ai does not display this ID anywhere in its interface, so you fetch it once yourself.

1. Sign in to [claude.ai](https://claude.ai) in the same browser.
2. In a new tab, open `https://claude.ai/api/organizations`. The page shows raw JSON. That is expected — it is not an error, and it is your own account data.
3. Find the value after `"uuid":`. It looks like `1a2b3c4d-5e6f-7890-abcd-ef1234567890`. Copy it **without** the quotation marks, keeping every dash.
4. Right-click the extension's toolbar icon and choose **Options**, or click the icon and use the setup link in the popup.
5. Paste the ID into **Organization ID** and click **Save Settings**.
6. Click **Test Connection**. A successful test reports how many conversations it found. If it does not, see [When something goes wrong](#when-something-goes-wrong).

If you belong to more than one Claude organization — a personal account and a school or work workspace, say — that page lists several entries. Use the `uuid` of the organization whose conversations you want to export. You can change it later on the Options page at any time.
{: .notice--info}

### Optional: set your export defaults

The Options page also holds three values that pre-fill every export's frontmatter:

- **Project** — a project key, such as `pdf2md`
- **Contributor** — your name, or whoever the transcript should be credited to
- **Tags** — a comma-separated starting list, such as `research, coursework`

Each has its own Save button, and any individual export can override all three. What they do to the exported file is covered under [Frontmatter]({{ '/usage/#frontmatter' | relative_url }}).

## Updating the extension

An unpacked extension never updates itself, and nothing will tell you a new version exists. Keeping this one current is your job. The [Change Log]({{ '/changelog/' | relative_url }}) is where new versions are announced.
{: .notice--warning}

Updating is two steps: replace the files, then tell Chrome to re-read them.

**If you downloaded the ZIP:** download it again, unpack it, and replace the old folder's contents with the new ones. If you unpack to a *new* folder instead, remove the extension from `chrome://extensions/` and load the new folder unpacked, since Chrome is still pointed at the old path.

**If you cloned with Git:**

```bash
cd ~/Documents/Claude-Interaction-Exporter
git pull
```

Then, either way, open `chrome://extensions/` and click the circular **reload** arrow on the extension's card. Reload any Claude.ai tabs you already had open, and check the version line in the popup to confirm the new build is live.

Your organization ID and export defaults survive updates — they live in your browser's extension storage, not in the folder.

## When something goes wrong

| Symptom | What to do |
| --- | --- |
| **Load unpacked** is not on the page | Developer mode is off. Toggle it on at the top right of `chrome://extensions/`. |
| "Manifest file is missing or unreadable" | Wrong folder. Select the folder that directly contains `manifest.json` — not its parent, and not `manifest.json` itself. If your extractor nested the contents, use the inner folder. |
| Chrome will not open the folder in the file picker | On Windows, you are probably still inside the ZIP preview window rather than an unpacked folder. Right-click the ZIP → **Extract All…**, then select the extracted folder. |
| You cannot find **Download ZIP** in the Code menu | It is the last item, below **Open with GitHub Desktop**. If the menu shows only **Codespaces**, click the **Local** tab at its top left. |
| The extension card shows an error or "missing" after a restart | The folder was moved, renamed, or deleted. Put it back, or remove the card and load the folder again from its new location. |
| "Organization ID not configured" | Finish [Stage 3](#stage-3-connect-your-claudeai-account). Paste the whole ID, dashes included, without quotation marks. |
| "Invalid Organization ID format" | The ID has to be a UUID — 8-4-4-4-12 characters separated by dashes. A conversation ID or a truncated paste is rejected. |
| "Not authenticated" | Sign in to Claude.ai, reload the page, and try again. |
| "Access denied" | The organization ID likely belongs to a different organization than the conversations you are exporting. Recheck `https://claude.ai/api/organizations` and pick the right `uuid`. |
| Nothing happens when you click Export | If the tab was already open when you installed or updated the extension, reload it once. The extension tries to handle this itself, but a reload always fixes it. |

Still stuck? [Open an issue](https://github.com/StrivenWord/Claude-Interaction-Exporter/issues) with the exact message you saw and which stage you reached.

## Next step

The extension is installed and connected. Head to [Usage]({{ '/usage/' | relative_url }}) to run your first export.
