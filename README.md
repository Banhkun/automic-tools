# Bosch AS-Portal Tools

5 maintainable scripts, 1 install via a meta-script.

---

## Files

| File | Purpose | Active on |
|------|---------|-----------|
| `bosch-meta-installer.user.js` | **The one you install** — loads all others | all pages |
| `Detail-Page-Tools.user.js` | Hamburger copy menu, AWI links, TEMP_DEACTIVATE, expandable description | `ASPortal/*` |
| `Column-Swapper.user.js` | Swaps "Hierarchy Type" ↔ "Appointment Date" columns | `ASPortal/Welcome*` |
| `ID36-Generator.user.js` | Generates & copies multiple ID36 values | `rb-wam.bosch.com/...3035*` |
| `apex-column-copy.user.js` | 📋 copy buttons on IG/IR column headers | `rb-wam.bosch.com/*` |
| `runmyjobs-tab-nav.user.js` | Tab/Shift+Tab navigation for UIReact-TabBar | `runmyjobs-dev1.emea.bosch.com/*` |

---

## Setup

### Step 1 — Push all files to GitHub

Upload all 6 files to the **root** of your GitHub repo (public or private).

### Step 2 — Edit the meta-installer

Open `bosch-meta-installer.user.js` and replace the two placeholders in every URL:

```
YOUR_USERNAME  →  your GitHub username
YOUR_REPO      →  your repository name
```

There are occurrences in both the `@require` lines and the `GITHUB_RAW_BASE` constant. Replace all of them.

### Step 3 — Install (one time only)

1. Push the edited `bosch-meta-installer.user.js` to GitHub
2. Open its **Raw** URL in your browser:
   ```
   https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/bosch-meta-installer.user.js
   ```
3. Tampermonkey detects the `==UserScript==` header → click **Install**

That's it. All 5 tools are now active.

---

## Updating a tool

1. Edit the relevant `.user.js` file
2. `git push`
3. In Tampermonkey → **Check for updates** (or wait for the auto-check interval)

Tampermonkey re-fetches all `@require` URLs on update, so your changes propagate automatically.

---

## How ID36 is handled differently

`ID36-Generator.user.js` needs to intercept `fetch` and `XHR` *before* the APEX page's own scripts run. `@require` executes in Tampermonkey's sandbox and can't do this reliably. Instead, the meta-installer fetches the ID36 script via `GM_xmlhttpRequest` and injects it as a `<script>` tag directly into the page at `document-start`, which gives it the correct early execution context.
