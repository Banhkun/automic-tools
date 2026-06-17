// ==UserScript==
// @name         Bosch AS-Portal Tools (Meta Installer)
// @namespace    bosch-asportal
// @version      2.2
// @description  Loads each Bosch AS-Portal tool only on its matching page.
// @author       Minh Dinh
//
// @match        https://rb-wam.bosch.com/*
// @match        https://apps-p-p1-outsystems.de.bosch.com/ASPortal/*
// @include      https://runmyjobs-*.emea.bosch.com/redwood/*
//
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addElement
// @grant        GM_registerMenuCommand
// @connect      raw.githubusercontent.com
//
// @updateURL    https://raw.githubusercontent.com/Banhkun/automic-tools/main/bosch-meta-installer.user.js
// @downloadURL  https://raw.githubusercontent.com/Banhkun/automic-tools/main/bosch-meta-installer.user.js
//
// @run-at       document-start
// ==/UserScript==

const BASE = 'https://raw.githubusercontent.com/Banhkun/automic-tools/main';
const href = location.href;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const ROUTES = [
  {
    name: 'Detail-Page-Tools',
    match: () => href.includes('apps-p-p1-outsystems.de.bosch.com/ASPortal/RequestDetail'),
    src: `${BASE}/Detail-Page-Tools.user.js`,
  },
  {
    match: () => href.includes(".bosch.com/awi/EUP"),
    src: `${BASE}/uc4-copy.js`,
  },
  {
    // Only run swapper on the list page, not on detail pages
    // Adjust the exclusion string to whatever your detail URL contains
    match: () =>
      href.includes("apps-p-p1-outsystems.de.bosch.com/ASPortal") &&
      !href.includes("RequestDetail"),
    src: `${BASE}/Column-Swapper.user.js`,
  },
  {
    name: 'RunMyJobs-Tab-Nav',
    match: () => href.includes('emea.bosch.com/redwood/ui'),
    src: `${BASE}/runmyjobs-tab-nav.user.js`,
  },
  {
    name: 'ID36-Generator',
    match: () => href.includes('rb-wam.bosch.com') && href.includes('f?p=100:3035'),
    src: `${BASE}/ID36-Generator.user.js`,
  },
];

// ─── Cache helpers ─────────────────────────────────────────────────────────────

function cacheKey(src)  { return 'cache__' + src; }
function stampKey(src)  { return 'stamp__' + src; }

function isCacheStale(src) {
  return (Date.now() - GM_getValue(stampKey(src), 0)) > CACHE_TTL_MS;
}

function saveToCache(src, text) {
  GM_setValue(cacheKey(src), text);
  GM_setValue(stampKey(src), Date.now());
}

function loadFromCache(src) {
  return GM_getValue(cacheKey(src), null);
}

function clearCache(src) {
  GM_setValue(cacheKey(src), null);
  GM_setValue(stampKey(src), 0);
}

function cacheAge(src) {
  const stamp = GM_getValue(stampKey(src), 0);
  if (!stamp) return null;
  const mins = Math.round((Date.now() - stamp) / 60000);
  return mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
}

// ─── Injection ─────────────────────────────────────────────────────────────────

function injectScript(sourceText) {
  const s = document.createElement('script');
  s.textContent = sourceText;
  (document.head || document.documentElement).appendChild(s);
  s.remove();
}

function fetchAndRun(src) {
  const cached = loadFromCache(src);
  if (cached && !isCacheStale(src)) {
    console.log(`[Bosch Tools] Fresh cache: ${src}`);
    injectScript(cached);
    return;
  }
  GM_xmlhttpRequest({
    method: 'GET', url: src, timeout: 8000,
    onload(res) {
      if (res.status >= 200 && res.status < 300 && res.responseText) {
        saveToCache(src, res.responseText);
        injectScript(res.responseText);
      } else { fallback(src); }
    },
    onerror()   { fallback(src); },
    ontimeout() { fallback(src); },
  });
}

function forceRefresh(src) {
  clearCache(src);
  GM_xmlhttpRequest({
    method: 'GET', url: src, timeout: 8000,
    onload(res) {
      if (res.status >= 200 && res.status < 300 && res.responseText) {
        saveToCache(src, res.responseText);
        alert(`✅ Re-fetched & cached:\n${src.split('/').pop()}`);
      } else {
        alert(`❌ Failed (HTTP ${res.status}):\n${src.split('/').pop()}`);
      }
    },
    onerror()   { alert(`❌ Network error fetching:\n${src.split('/').pop()}`); },
    ontimeout() { alert(`❌ Timeout fetching:\n${src.split('/').pop()}`); },
  });
}

function fallback(src) {
  const cached = loadFromCache(src);
  if (cached) { injectScript(cached); }
  else { console.error(`[Bosch Tools] No cache & failed: ${src}`); }
}

// ─── Run matched routes ────────────────────────────────────────────────────────

const activeRoutes = ROUTES.filter(r => r.match());
activeRoutes.forEach(({ src }) => fetchAndRun(src));

// ─── Context menu commands ─────────────────────────────────────────────────────

// 1. One entry per active script on this page — shows freshness, click to force refresh
if (activeRoutes.length === 0) {
  GM_registerMenuCommand('ℹ️ No scripts active on this page', () => {});
} else {
  activeRoutes.forEach(({ name, src }) => {
    const cached = !!loadFromCache(src);
    const stale  = isCacheStale(src);
    const age    = cacheAge(src);

    const icon  = !cached ? '❌' : stale ? '⚠️' : '✅';
    const label = `${icon} ${name}${age ? ` · ${age}` : ''}`;

    GM_registerMenuCommand(label, () => forceRefresh(src));
  });
}

// 2. Bulk actions
GM_registerMenuCommand('🔄 Refresh this page\'s caches', () => {
  if (!activeRoutes.length) { alert('No scripts active on this page.'); return; }
  activeRoutes.forEach(({ src }) => clearCache(src));
  alert(`Cleared ${activeRoutes.length} cache(s).\nReload the page to re-fetch.`);
});

GM_registerMenuCommand('🗑️ Clear ALL script caches', () => {
  ROUTES.forEach(({ src }) => clearCache(src));
  alert(`All ${ROUTES.length} caches cleared.\nEach script will re-fetch on next visit.`);
});

// 3. Full status report
GM_registerMenuCommand('📊 Cache status report', () => {
  const lines = ROUTES.map(({ name, src }) => {
    const cached = !!loadFromCache(src);
    const stale  = isCacheStale(src);
    const age    = cacheAge(src);
    const icon   = !cached ? '❌' : stale ? '⚠️' : '✅';
    return `${icon} ${name}: ${age ? (stale ? 'stale · ' : 'fresh · ') + age : 'no cache'}`;
  });
  alert('Bosch AS-Portal Tools — Cache Status\n\n' + lines.join('\n'));
});
