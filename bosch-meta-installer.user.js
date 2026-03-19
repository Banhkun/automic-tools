// ==UserScript==
// @name         Bosch AS-Portal Tools (Meta Installer)
// @namespace    bosch-asportal
// @version      1.0
// @description  Loads all Bosch AS-Portal tools from GitHub. One install — 5 scripts.
// @author       You
//
// ─── SETUP: Replace YOUR_USERNAME and YOUR_REPO below with your GitHub details ───
//
// @require      https://raw.githubusercontent.com/Banhkun/automic-tools/main/Detail-Page-Tools.user.js
// @require      https://raw.githubusercontent.com/Banhkun/automic-tools/main/Column-Swapper.user.js
// @require      https://raw.githubusercontent.com/Banhkun/automic-tools/main/apex-column-copy.user.js
// @require      https://raw.githubusercontent.com/Banhkun/automic-tools/main/runmyjobs-tab-nav.user.js
//
// NOTE: ID36-Generator is NOT listed under @require because it must intercept
// fetch/XHR before the page's own scripts load. It is injected via <script> tag
// below, which gives it the required early page-world execution.
// Its source URL is set in the SCRIPTS config object further down.
//
// @match        https://rb-wam.bosch.com/*
// @match        https://apps-p-p1-outsystems.de.bosch.com/ASPortal/*
// @match        https://runmyjobs-dev1.emea.bosch.com/redwood/ui*
//
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
//
// @updateURL    https://raw.githubusercontent.com/Banhkun/automic-tools/main/bosch-meta-installer.user.js
// @downloadURL  https://raw.githubusercontent.com/Banhkun/automic-tools/main/bosch-meta-installer.user.js
//
// @run-at       document-start
// ==/UserScript==

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION — update YOUR_USERNAME and YOUR_REPO to match your GitHub repo
// ─────────────────────────────────────────────────────────────────────────────
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/Banhkun/automic-tools/main';

const SCRIPTS = {
  // ID36 must be fetched and injected into page-world (not via @require)
  // so its fetch/XHR interceptors wrap the page's network calls correctly.
  id36: `${GITHUB_RAW_BASE}/ID36-Generator.user.js`,
};

// ─────────────────────────────────────────────────────────────────────────────
// ID36: Fetch source from GitHub and inject as a <script> tag into page-world.
// Only runs on the ID36 APEX page.
// ─────────────────────────────────────────────────────────────────────────────
if (location.href.includes('rb-wam.bosch.com') && location.href.includes('f?p=100:3035')) {
  GM_xmlhttpRequest({
    method: 'GET',
    url: SCRIPTS.id36,
    onload: function (response) {
      const script = document.createElement('script');
      script.textContent = response.responseText;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    },
    onerror: function () {
      console.error('[Bosch Tools] Failed to load ID36-Generator from GitHub. Check your GITHUB_RAW_BASE URL and network access.');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// All other scripts (@require'd above) execute automatically via Tampermonkey.
// No additional code needed here for them — they self-initialise.
// ─────────────────────────────────────────────────────────────────────────────
