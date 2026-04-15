// ==UserScript==
// @name         Bosch AS-Portal Tools (Meta Installer)
// @namespace    bosch-asportal
// @version      2.0
// @description  Loads each Bosch AS-Portal tool only on its matching page.
// @author       You
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

const BASE = 'https://raw.githubusercontent.com/Banhkun/automic-tools/main';
const href = location.href;

// Each entry: [ urlCondition, scriptFile, needsPageWorld ]
// needsPageWorld = true  → inject via <script> tag (page-world, wraps fetch/XHR)
// needsPageWorld = false → inject via <script> tag as well for simplicity & consistency
const ROUTES = [
  {
    // Detail Page Tools — adjust the URL fragment to match your APEX page
    match: () => href.includes('rb-wam.bosch.com') && href.includes('f?p=100:32'),
    src: `${BASE}/Detail-Page-Tools.user.js`,
  },
  {
    // Column Swapper + APEX column copy — runs on the AS-Portal OutSystems pages
    match: () => href.includes('apps-p-p1-outsystems.de.bosch.com/ASPortal'),
    src: `${BASE}/Column-Swapper.user.js`,
  },
  {
    // APEX column copy — same site, separate script
    match: () => href.includes('apps-p-p1-outsystems.de.bosch.com/ASPortal'),
    src: `${BASE}/apex-column-copy.user.js`,
  },
  {
    // RunMyJobs tab navigation
    match: () => href.includes('runmyjobs-dev1.emea.bosch.com/redwood/ui'),
    src: `${BASE}/runmyjobs-tab-nav.user.js`,
  },
  {
    // ID36 Generator — must intercept fetch/XHR before page scripts, so it
    // also uses <script> injection (page-world). Same mechanism as the others.
    match: () => href.includes('rb-wam.bosch.com') && href.includes('f?p=100:3035'),
    src: `${BASE}/ID36-Generator.user.js`,
  },
];

function injectScript(sourceText) {
  const script = document.createElement('script');
  script.textContent = sourceText;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

ROUTES.forEach(({ match, src }) => {
  if (!match()) return; // ← skip if URL doesn't match

  GM_xmlhttpRequest({
    method: 'GET',
    url: src,
    onload: (res) => injectScript(res.responseText),
    onerror: () => console.error(`[Bosch Tools] Failed to load: ${src}`),
  });
});
