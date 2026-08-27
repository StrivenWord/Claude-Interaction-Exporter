---
title: "Installation"
permalink: /installation/
excerpt: "Get the extension's files, load them into your browser, and connect it to your Claude.ai account."
---

Claude Interaction Exporter is not yet in the Chrome Web Store, so you install it the way developers install an extension they are working on: you put the extension's folder somewhere on your computer, then point your browser at that folder. This is called **loading unpacked**, and it takes about five minutes.

There are three stages:

1. **Get the files** — clone the repository with Git, or download a ZIP archive and unpack it.
2. **Load the folder** into your browser from the extensions page.
3. **Connect your Claude.ai account** by entering your organization ID once.

**Prerequisites:** Chrome, or another Chromium-based browser (Edge, Brave, Opera, Vivaldi), and a Claude.ai account you can sign in to. There is no build step and nothing to install — no Node.js, no `npm install`, no compiler. The extension runs from the files exactly as they come out of the repository.
{: .notice--info}

Firefox and Safari are not supported. The extension is built on Chrome's Manifest V3 extension APIs.
{: .notice--warning}

## Stage 1: Get the files

Pick whichever of the two methods you are more comfortable with. They produce the same files; the only real difference is how you get updates later.

| | Clone with Git | Download the ZIP |
| --- | --- | --- |
| Needs | Git installed | Nothing but a browser |
| Updating | `git pull` in the folder | Download and unpack again |
| Best for | Anyone who already uses Git | Everyone else |

### Option A: Clone the repository with Git

Cloning makes a full copy of the repository on your computer, along with its history, so that updating later is a single command.

First, check that Git is installed. Open a terminal — **Terminal** on macOS or Linux, **Command Prompt**, **PowerShell**, or **Git Bash** on Windows — and run:

```bash
git --version
```

If that prints a version number, you have Git. If the command is not found, install it from [git-scm.com/downloads](https://git-scm.com/downloads) and open a new terminal window afterward.

Now move to wherever you keep projects and clone the repository:

```bash
cd ~/Documents
git clone https://github.com/StrivenWord/Claude-Interaction-Exporter.git
```

That creates a folder named `Claude-Interaction-Exporter` inside `~/Documents`. On Windows, use a path such as `cd %USERPROFILE%\Documents` instead.

Confirm you have the extension's files, `manifest.json` in particular:

```bash
cd Claude-Interaction-Exporter
ls
```

You should see `manifest.json`, `background.js`, `content.js`, `popup.html`, `utils.js`, and the rest. On Windows Command Prompt, use `dir` rather than `ls`.

To update later, run `git pull` from inside that same folder, then reload the extension — see [Updating the extension](#updating-the-extension).

### Option B: Download and unpack the ZIP archive

If you would rather not use Git, GitHub will hand you the same files as a single ZIP archive.

1. Open the repository: [github.com/StrivenWord/Claude-Interaction-Exporter](https://github.com/StrivenWord/Claude-Interaction-Exporter).
2. Click the green **Code** button, near the top right of the file list.
3. In the menu that drops down, click **Download ZIP**. Your browser saves a file named `Claude-Interaction-Exporter-main.zip`, normally to your Downloads folder. (The `-main` suffix is the name of the repository's main branch.)
4. Move the ZIP file out of Downloads to somewhere you intend to keep — `Documents`, for instance. The folder you unpack has to stay put permanently, so unpacking it in Downloads is a poor idea; see the warning below.
5. Unpack it:
   - **macOS** — double-click the ZIP file. Archive Utility unpacks it beside the archive and leaves a folder named `Claude-Interaction-Exporter-main`.
   - **Windows** — right-click the ZIP file and choose **Extract All…**, then confirm the destination and click **Extract**. Do not just double-click the ZIP: that opens a read-only preview window that *looks* like a folder, and Chrome cannot load an extension from it.
   - **Linux** — `unzip Claude-Interaction-Exporter-main.zip`, or use your file manager's **Extract Here**.
6. Open the resulting folder and check that `manifest.json` sits directly inside it, not one level deeper.

Some extractors nest the contents, leaving you with `Claude-Interaction-Exporter-main/Claude-Interaction-Exporter-main/manifest.json`. If that happens, the folder you want in the next stage is the inner one — the one that directly contains `manifest.json`.
{: .notice--info}

### Keep the folder where you put it

Chrome does not copy an unpacked extension into itself. It records the path to your folder and reads the files from that path every time the browser starts. If you later delete the folder, move it, or rename it, the extension breaks and Chrome reports it as missing or corrupted.

Put the folder somewhere permanent before loading it, and leave it there. Downloads folders and Desktop are risky, especially with macOS's "Optimize Storage" or any tool that periodically empties Downloads.
{: .notice--danger}

## Stage 2: Load the extension into your browser

1. Open a new tab and go to `chrome://extensions/`. Typing that address is more reliable than hunting through menus; on Edge the equivalent is `edge://extensions/`, and Brave uses `brave://extensions/`.
2. Turn on **Developer mode** with the toggle at the top right of that page. Three buttons appear — **Load unpacked**, **Pack extension**, **Update**.
3. Click **Load unpacked**.
4. In the file picker, select the folder that directly contains `manifest.json` — `Claude-Interaction-Exporter` if you cloned, `Claude-Interaction-Exporter-main` if you unpacked the ZIP. Select the *folder itself*; do not open it and select `manifest.json`.
5. A card titled **Claude Interaction Exporter** appears on the extensions page. That is it — the extension is installed.
6. Pin it to the toolbar so it is one click away: click the puzzle-piece icon at the right of the address bar, find the extension in the list, and click the pin beside its name.

Chrome will ask you to approve one permission: *Read and change your data on claude.ai.* That is the extension's only host permission, and claude.ai is the only site it can reach. The [Privacy]({{ '/privacy/' | relative_url }}) page explains each permission the extension requests and why.

Once developer mode is on, Chrome shows a "Disable developer mode extensions" prompt each time it starts. That warning is about unpacked extensions in general, not about this one; dismissing it leaves the extension working.
{: .notice--info}

### Confirm which build is loaded

The extension's version is written in small print at the bottom of the toolbar popup and at the top right of the browse page — for example `1.5.3 — 2026-08-21`. After any update, check that line to be sure the reload actually took effect.

## Stage 3: Connect your Claude.ai account

The extension asks Claude.ai's API for your conversations, and the address of that API includes your **organization ID**. Claude.ai does not display this ID anywhere in its interface, so you have to fetch it once yourself. It is a one-time step.

1. Sign in to [claude.ai](https://claude.ai) in the same browser.
2. In a new tab, open `https://claude.ai/api/organizations`. The page shows raw JSON. That is expected — it is not an error, and it is your own account data.
3. Find the value after `"uuid":`. It looks like `1a2b3c4d-5e6f-7890-abcd-ef1234567890`. Copy it **without** the surrounding quotation marks, keeping every dash.
4. Right-click the extension's toolbar icon and choose **Options**, or click the icon and use the setup link in the popup.
5. Paste the ID into **Organization ID** and click **Save Settings**.
6. Click **Test Connection**. A successful test reports how many conversations it found. If it does not, see [When something goes wrong](#when-something-goes-wrong).

If you belong to more than one Claude organization — a personal account and a school or work workspace, say — that page lists several entries. Use the `uuid` of the organization whose conversations you want to export. You can change it later on the Options page at any time.
{: .notice--info}

### Optional: set your export defaults

The Options page also holds three values that pre-fill every export's frontmatter, so you do not retype them each time:

- **Project** — a project key, such as `pdf2md`
- **Contributor** — your name, or whoever the transcript should be credited to
- **Tags** — a comma-separated starting list, such as `research, coursework`

Each has its own Save button, and any individual export can override all three. What these values do to the exported file is covered under [Frontmatter]({{ '/usage/#frontmatter' | relative_url }}).

## Updating the extension

Updating is two steps: replace the files, then tell Chrome to re-read them.

**If you cloned with Git:**

```bash
cd ~/Documents/Claude-Interaction-Exporter
git pull
```

**If you downloaded the ZIP:** download it again, unpack it, and replace the old folder's contents with the new ones. If you unpack to a *new* folder rather than replacing the old one, remove the extension from `chrome://extensions/` and load the new folder unpacked, since Chrome is still pointed at the old path.

Then, either way, open `chrome://extensions/` and click the circular **reload** arrow on the extension's card. Reload any Claude.ai tabs you already had open, and check the version line in the popup to confirm the new build is live.

Your organization ID and export defaults survive updates — they live in your browser's extension storage, not in the folder.

## When something goes wrong

| Symptom | What to do |
| --- | --- |
| **Load unpacked** is not on the page | Developer mode is off. Toggle it on at the top right of `chrome://extensions/`. |
| "Manifest file is missing or unreadable" | You selected the wrong folder. Select the folder that directly contains `manifest.json` — not its parent, and not `manifest.json` itself. If your extractor nested the contents, use the inner folder. |
| Chrome will not open the folder in the file picker | On Windows, you are probably still inside the ZIP preview window rather than an unpacked folder. Right-click the ZIP → **Extract All…**, then select the extracted folder. |
| The extension card shows an error or "missing" after a restart | The folder was moved, renamed, or deleted. Put it back, or remove the card and load the folder again from its new location. |
| "Organization ID not configured" | Finish [Stage 3](#stage-3-connect-your-claudeai-account). Paste the whole ID, dashes included, without quotation marks. |
| "Invalid Organization ID format" | The ID has to be a UUID — 8-4-4-4-12 characters separated by dashes. A conversation ID or a truncated paste is rejected. |
| "Not authenticated" | Sign in to Claude.ai, reload the page, and try again. |
| "Access denied" | The organization ID likely belongs to a different organization than the conversations you are exporting. Recheck `https://claude.ai/api/organizations` and pick the right `uuid`. |
| Nothing happens when you click Export | If the tab was already open when you installed or updated the extension, reload it once. The extension tries to handle this itself, but a reload always fixes it. |

Still stuck? [Open an issue](https://github.com/StrivenWord/Claude-Interaction-Exporter/issues) with the exact message you saw and which stage you reached.

## Next step

The extension is installed and connected. Head to [Usage]({{ '/usage/' | relative_url }}) to run your first export.
