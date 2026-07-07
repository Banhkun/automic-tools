// ==UserScript==
// @name         RMJ CSV File Viewer
// @namespace    bosch-rmj-fix
// @version      2.2
// @description  Intercepts RMJ job file iframes that serve raw CSVs and
//               replaces them with an inline styled HTML table.
//               Adds sticky row-number column + click header to copy column.
// @include      *://*/redwood/ui*
// @grant        GM_xmlhttpRequest
// @connect      runmyjobs-dev1.emea.bosch.com

// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const FILE_URL_RE = /\/redwood\/jobfile\/viewer-url\//;

  // ── CSV parser ─────────────────────────────────────────────────────────
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else if (c === '"') {
        inQ = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (c !== '\r') {
        field += c;
      }
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(f => f.trim()));
  }

  // ── Toast ──────────────────────────────────────────────────────────────
  function showToast(wrap, msg) {
    let t = wrap.querySelector('.rmj-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'rmj-toast';
      t.style.cssText = `
        position:sticky; top:4px; float:right;
        background:#1a5276; color:#fff;
        font-size:11px; padding:3px 10px;
        border-radius:4px; opacity:0;
        transition:opacity .2s; pointer-events:none; z-index:10;
      `;
      wrap.prepend(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.style.opacity = '0', 1800);
  }

  // ── Build table ────────────────────────────────────────────────────────
  function buildTable(rows, wrap) {
    const esc = s => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const [head, ...body] = rows;
    const table = document.createElement('table');
    const thead = table.createTHead();
    const hRow  = thead.insertRow();
    const tbody = table.createTBody();

    // "No." sticky corner header
    const thNo = document.createElement('th');
    thNo.textContent = 'No.';
    thNo.className = 'rmj-col-no rmj-corner';
    hRow.appendChild(thNo);

    // Data column headers
    head.forEach((h, colIdx) => {
      const th = document.createElement('th');
      th.innerHTML = esc(h) + ' <span class="rmj-copy-hint">📋</span>';
      th.title = `Click to copy column "${h}"`;
      th.addEventListener('click', () => {
        const values = body.map(r => r[colIdx] ?? '').join('\n');
        navigator.clipboard.writeText(values).then(() =>
          showToast(wrap, `✓ Copied ${body.length} values from "${h}"`));
      });
      hRow.appendChild(th);
    });

    // Body rows
    body.forEach((r, i) => {
      const tr = tbody.insertRow();
      if (i % 2 === 0) tr.className = 'even';

      // Row number cell
      const tdNo = tr.insertCell();
      tdNo.textContent = i + 1;
      tdNo.className = 'rmj-col-no';

      // Data cells
      head.forEach((_, ci) => {
        const td = tr.insertCell();
        td.textContent = r[ci] ?? '';
      });
    });

    return table;
  }

  // ── Replace iframe with viewer ─────────────────────────────────────────
  function renderInPlace(iframe, csvText, src) {
    const rows = parseCSV(csvText);
    if (!rows.length) return;

    const wrap = document.createElement('div');
    wrap.className = 'rmj-csv-viewer';
    wrap.style.cssText = iframe.style.cssText;
    const cs = getComputedStyle(iframe);
    wrap.style.flexGrow  = cs.flexGrow;
    wrap.style.overflow  = 'auto';
    wrap.style.padding   = '12px 16px';
    wrap.style.boxSizing = 'border-box';

    const style = document.createElement('style');
    style.textContent = `
      .rmj-csv-viewer table {
        border-collapse: collapse;
        width: max-content; min-width: 100%;
        font-size: 13px; font-family: monospace;
      }

      /* sticky top headers */
      .rmj-csv-viewer th {
        position: sticky; top: 0; z-index: 2;
        background: #1a5276; color: #fff;
        padding: 6px 12px; text-align: left;
        white-space: nowrap;
        border-right: 1px solid #154360;
        font-weight: 500;
        cursor: pointer; user-select: none;
      }
      .rmj-csv-viewer th:hover { background: #1f618d; }
      .rmj-csv-viewer th:hover .rmj-copy-hint { opacity: 1; }
      .rmj-copy-hint {
        opacity: 0; font-size: 11px;
        margin-left: 5px; transition: opacity .15s;
      }

      /* sticky left No. column */
      .rmj-col-no {
        position: sticky; left: 0; z-index: 3;
        background: #154360 !important;
        color: #fff !important;
        text-align: center;
        min-width: 42px; width: 42px;
        cursor: default !important;
        border-right: 2px solid #0e2f44 !important;
        font-weight: 600;
      }
      /* corner: sticky both top and left */
      .rmj-corner { z-index: 4 !important; }

      /* body No. cells */
      .rmj-csv-viewer td.rmj-col-no {
        background: #d6e8f7;
        color: #0e2f44;
        font-weight: 600;
        border-right: 2px solid #a9cde8 !important;
      }
      .rmj-csv-viewer tr.even td.rmj-col-no { background: #bdd7ee; }
      .rmj-csv-viewer tr:hover td.rmj-col-no { background: #93c6e8 !important; }

      /* data cells */
      .rmj-csv-viewer td {
        padding: 4px 12px;
        border-bottom: 1px solid rgba(0,0,0,.06);
        border-right: 1px solid rgba(0,0,0,.05);
        white-space: nowrap; color: #111;
      }
      .rmj-csv-viewer tr.even td { background: #f4f8fb; }
      .rmj-csv-viewer tr:not(.even) td { background: #fff; }
      .rmj-csv-viewer tr:hover td { background: #dbeafe !important; }

      .rmj-csv-viewer .rmj-dl {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 12px; margin-bottom: 8px; padding: 4px 10px;
        background: #1a5276; color: #fff; border-radius: 5px;
        text-decoration: none; cursor: pointer;
      }
    `;

    const link = document.createElement('a');
    link.className = 'rmj-dl';
    link.href = src;
    link.download = src.split('/').pop();
    link.textContent = '⬇ Download CSV';

    const info = document.createElement('div');
    info.style.cssText = 'font-size:11px;color:#555;margin-bottom:6px';
    info.textContent =
      `${rows.length - 1} rows × ${rows[0].length} columns — click a header to copy its column`;

    const table = buildTable(rows, wrap);
    wrap.append(style, link, info, table);
    iframe.parentNode.replaceChild(wrap, iframe);
    console.log('[RMJ-csv] rendered', rows.length - 1, 'rows');
  }

  // ── Fetch and intercept ────────────────────────────────────────────────
  function interceptIframe(iframe) {
    const src = iframe.src || iframe.getAttribute('src');
    if (!src || !FILE_URL_RE.test(src)) return;
    if (iframe.dataset.rmjHandled) return;
    iframe.dataset.rmjHandled = '1';

    GM_xmlhttpRequest({
      method: 'GET',
      url: src,
      onload(res) {
        if (res.status === 200)
          renderInPlace(iframe, res.responseText, src);
        else
          console.warn('[RMJ-csv] fetch failed', res.status, src);
      },
      onerror(e) { console.error('[RMJ-csv] error', e, src); }
    });
  }

  document.querySelectorAll('iframe').forEach(interceptIframe);

  new MutationObserver((mutations) => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches('iframe')) interceptIframe(node);
        node.querySelectorAll?.('iframe')?.forEach(interceptIframe);
      }
    }
  }).observe(document.body, { subtree: true, childList: true });

})();
