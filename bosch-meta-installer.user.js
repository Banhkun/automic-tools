// ==UserScript==
// @name         Bosch AS-Portal Tools (Meta Installer)
// @namespace    bosch-asportal
// @version      2.1
// @description  Loads each Bosch AS-Portal tool only on its matching page. Caches scripts locally so tools work even when GitHub or the network is down.
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
// @connect      raw.githubusercontent.com
//
// @updateURL    https://raw.githubusercontent.com/Banhkun/automic-tools/main/bosch-meta-installer.user.js
// @downloadURL  https://raw.githubusercontent.com/Banhkun/automic-tools/main/bosch-meta-installer.user.js
//
// @run-at       document-start
// ==/UserScript==

const BASE = 'https://raw.githubusercontent.com/Banhkun/automic-tools/main';
const href = location.href;

// How long (in ms) before a cached script is considered stale and re-fetched.
// Default: 6 hours. Change to 0 to always fetch fresh.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Each entry: [ match(), script file ]
const ROUTES = [
  {
    match: () => href.includes("apps-p-p1-outsystems.de.bosch.com/ASPortal/RequestDetail"),
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
    match: () =>
      href.includes("rb-wam.bosch.com") && href.includes("f?p=100:32"),
    src: `${BASE}/apex-column-copy.user.js`,
  },
  {
    match: () =>
      href.includes("rb-wam.bosch.com") && href.includes("f?p=100:3035"),
    src: `${BASE}/ID36-Generator.user.js`,
  },
];

function injectScript(sourceText) {
  const script = document.createElement('script');
  script.textContent = sourceText;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

// Cache keys: store script text and the timestamp of last successful fetch separately.
function cacheKey(src)  { return 'cache__' + src; }
function stampKey(src)  { return 'stamp__' + src; }

function isCacheStale(src) {
  const stamp = GM_getValue(stampKey(src), 0);
  return (Date.now() - stamp) > CACHE_TTL_MS;
}

function saveToCache(src, text) {
  GM_setValue(cacheKey(src), text);
  GM_setValue(stampKey(src), Date.now());
}

function loadFromCache(src) {
  return GM_getValue(cacheKey(src), null);
}

function fetchAndRun(src) {
  const cached = loadFromCache(src);
  const stale  = isCacheStale(src);

  // If we have a fresh cache, use it immediately — no network needed.
  if (cached && !stale) {
    console.log(`[Bosch Tools] Cache hit (fresh): ${src}`);
    injectScript(cached);
    return;
  }

  // If cache is stale (or missing), try to fetch a fresh copy.
  GM_xmlhttpRequest({
    method: 'GET',
    url: src,

    onload(res) {
      if (res.status >= 200 && res.status < 300 && res.responseText) {
        saveToCache(src, res.responseText);
        console.log(`[Bosch Tools] Fetched & cached: ${src}`);
        injectScript(res.responseText);
      } else {
        // GitHub returned a non-200 (e.g. 404, 500) — fall back to cache.
        console.warn(`[Bosch Tools] Bad response (${res.status}) — falling back to cache: ${src}`);
        fallback(src);
      }
    },

    onerror() {
      // Network error (offline, DNS failure, GitHub down, etc.) — use cache.
      console.warn(`[Bosch Tools] Network error — falling back to cache: ${src}`);
      fallback(src);
    },

    ontimeout() {
      console.warn(`[Bosch Tools] Timeout — falling back to cache: ${src}`);
      fallback(src);
    },

    timeout: 8000, // 8 s — give up waiting and use cache instead of hanging
  });
}

function fallback(src) {
  const cached = loadFromCache(src);
  if (cached) {
    console.warn(`[Bosch Tools] Running stale cache for: ${src}`);
    injectScript(cached);
  } else {
    console.error(`[Bosch Tools] No cache available & failed to load: ${src}`);
  }
}

// Run only the scripts whose URL condition matches the current page.
ROUTES.forEach(({ match, src }) => {
  if (!match()) return;
  fetchAndRun(src);
});
