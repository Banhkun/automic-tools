// ==UserScript==
// @name         Redwood Support Query Helper
// @namespace    redwood-query-helper
// @version      0.4.0
// @description  Adds tabbed, reusable SQL query templates to the Redwood /redwood/support/query page (e.g. "find parent job chain for a list of job definitions").
// @match        *://*/redwood/support
// @match        *://*/redwood/support/
// @match        *://*/redwood/support/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* -----------------------------------------------------------------------
   * 0. AUTO-RENDER THE QUERY PAGE
   * -------------------------------------------------------------------
   * Navigating straight to /redwood/support/query (GET) returns an empty
   * page - the report/query UI only renders after the small form on
   * /redwood/support POSTs an (even empty) `query` field to that same URL.
   * If we land on the query page and it's empty, auto-submit that same
   * empty POST ourselves so the page renders without the manual detour.
   * A sessionStorage flag stops this from looping if the empty response
   * persists for some other reason.
   * ---------------------------------------------------------------------*/

  function ensureQueryPageRendered() {
    const path = location.pathname.replace(/\/+$/, ''); // strip trailing slash(es)
    if (!/\/redwood\/support\/query$/.test(path)) return false;
    if (document.getElementById('queryEdit')) return false; // already rendered - nothing to do

    const FLAG = 'rqh-auto-post-attempted';
    let alreadyTried = false;
    try {
      alreadyTried = sessionStorage.getItem(FLAG) === '1';
    } catch (e) {
      /* sessionStorage unavailable - just attempt once, no loop guard */
    }
    if (alreadyTried) return false;

    try {
      sessionStorage.setItem(FLAG, '1');
    } catch (e) {
      /* non-fatal */
    }

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/redwood/support/query';
    form.style.display = 'none';

    const input = document.createElement('textarea');
    input.name = 'query';
    input.value = '';
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
    return true; // navigating away - caller should skip the rest of init
  }

  /* -----------------------------------------------------------------------
   * 1. TAB CONFIGURATION
   * -------------------------------------------------------------------
   * Each tab describes one "wrapper" around a complex query.
   *   id          - unique string
   *   label       - shown on the tab button
   *   description - short help text shown above the input box
   *   inputLabel  - label for the textarea where the user pastes values
   *   buildQuery(list, rawInput) -> SQL string
   *       `list` is an array of trimmed, non-empty lines/tokens the user pasted
   *       `rawInput` is the untouched textarea value, in case you need it
   *
   * Add new tabs by pushing more objects into TAB_CONFIGS.
   * ---------------------------------------------------------------------*/

  // Helper: turn a newline/comma separated blob into a deduped array of
  // trimmed, non-empty strings.
  function parseList(raw) {
    return Array.from(
      new Set(
        raw
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      )
    );
  }

  // Helper: turn an array of strings into a SQL-safe quoted IN(...) list.
  // NOTE: naive escaping (doubles single quotes) - fine for job def names,
  // which shouldn't contain quotes, but review before use with free text.
  function sqlInList(values) {
    return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
  }

  /* -----------------------------------------------------------------------
   * 1a. QUERY-EDIT COLLAPSE (raw SQL box)
   * -------------------------------------------------------------------
   * The raw `#queryEdit` textarea isn't needed by end users day-to-day -
   * they use the tabs above it. Wrap it behind a small "Raw SQL query"
   * toggle, collapsed by default, remembered across form submits via
   * sessionStorage (submits are full page reloads).
   *
   * Exception: on the "Free Query" tab the raw textarea IS the only
   * field, so it's forced open and the toggle is hidden while that tab
   * is active (see forceOpen/releaseForce, wired up in selectTab).
   * ---------------------------------------------------------------------*/

  function injectRQHCollapseStyles() {
    if (document.getElementById('rqh-collapse-styles')) return;
    const style = document.createElement('style');
    style.id = 'rqh-collapse-styles';
    style.textContent = `
      .rqh-query-toggle {
        cursor: pointer;
        user-select: none;
        font-family: verdana, sans-serif;
        font-size: 12px;
        color: #1a5276;
        margin-bottom: 4px;
        display: inline-block;
      }
      .rqh-query-toggle:hover { text-decoration: underline; }
      .rqh-query-collapsed { display: none; }
    `;
    document.head.appendChild(style);
  }

  // Returns a control object ({ forceOpen, releaseForce }) so callers
  // (the tab switcher) can force the box open for tabs with no other
  // input field, or null if the textarea was already wired up before.
  function makeQueryEditCollapsible(textarea) {
    if (!textarea || textarea.dataset.rqhCollapsible) return null;
    textarea.dataset.rqhCollapsible = '1';

    injectRQHCollapseStyles();

    let visible = false;
    try {
      visible = sessionStorage.getItem('rqh-query-visible') === '1';
    } catch (e) {
      /* sessionStorage unavailable - default to collapsed */
    }

    const toggle = document.createElement('div');
    toggle.className = 'rqh-query-toggle';
    function updateLabel() {
      toggle.textContent = (visible ? '▼' : '▶') + ' Raw SQL query';
    }
    updateLabel();

    textarea.classList.toggle('rqh-query-collapsed', !visible);
    textarea.parentNode.insertBefore(toggle, textarea);

    let forced = false;

    toggle.addEventListener('click', () => {
      if (forced) return; // ignore manual toggling while forced open (Free Query tab)
      visible = !visible;
      textarea.classList.toggle('rqh-query-collapsed', !visible);
      updateLabel();
      try {
        sessionStorage.setItem('rqh-query-visible', visible ? '1' : '0');
      } catch (e) {
        /* non-fatal */
      }
    });

    return {
      forceOpen() {
        forced = true;
        textarea.classList.remove('rqh-query-collapsed');
        toggle.style.display = 'none';
      },
      releaseForce() {
        forced = false;
        toggle.style.display = '';
        textarea.classList.toggle('rqh-query-collapsed', !visible);
        updateLabel();
      },
    };
  }

  /* -----------------------------------------------------------------------
   * 1b. RESULT TABLE ENHANCEMENT
   * -------------------------------------------------------------------
   * Adds to the server-rendered `<table class="report-outside">` results:
   *   - a leading "No." row-number column
   *   - click a column header to copy that whole column
   *   - Excel-style range selection (click, shift-click, ctrl-click, drag)
   *     with Ctrl+C to copy the selected rectangle
   * Mirrors the interaction pattern from the RMJ CSV Viewer userscript.
   * ---------------------------------------------------------------------*/

  function injectRQHTableStyles() {
    if (document.getElementById('rqh-table-styles')) return;
    const style = document.createElement('style');
    style.id = 'rqh-table-styles';
    style.textContent = `
      .rqh-report-wrap { position: relative; outline: none; }
      .rqh-report-table td.rqh-col-no, .rqh-report-table th.rqh-col-no {
        text-align: center; font-weight: 600;
      }
      .rqh-report-table td.rqh-col-no {
        background: #d6e8f7; color: #0e2f44;
      }
      .rqh-report-table th[data-rqh-copyable] { cursor: pointer; }
      .rqh-report-table th[data-rqh-copyable]:hover { background: #4a7fb5 !important; }
      .rqh-report-table td:not(.rqh-col-no) { cursor: cell; user-select: none; }
      .rqh-report-table td.rqh-sel {
        background: #bfdbfe !important; outline: 1px solid #3b82f6;
      }
      .rqh-toast {
        position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
        background: #1a5276; color: #fff; font-size: 11px; padding: 3px 10px;
        border-radius: 4px; opacity: 0; transition: opacity .2s;
        pointer-events: none; z-index: 20; white-space: nowrap;
        font-family: verdana, sans-serif;
      }
      .rqh-report-table tr.report-classname,
      .rqh-report-table tr.report-datatype {
        display: none;
      }
      .rqh-report-table.rqh-show-meta tr.report-classname,
      .rqh-report-table.rqh-show-meta tr.report-datatype {
        display: table-row;
      }
      .rqh-meta-toggle {
        cursor: pointer;
        user-select: none;
        font-size: 10px;
        text-decoration: underline;
        color: #1a5276 !important;
      }
      .rqh-meta-toggle:hover { color: #0e2f44 !important; }
    `;
    document.head.appendChild(style);
  }

  function showRQHToast(wrap, msg) {
    let t = wrap.querySelector('.rqh-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'rqh-toast';
      wrap.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._rqhTid);
    t._rqhTid = setTimeout(() => {
      t.style.opacity = '0';
    }, 1800);
  }

  function enhanceReportTable(table) {
    if (!table || table.dataset.rqhEnhanced) return;
    const thead = table.tHead;
    const tbody = table.tBodies && table.tBodies[0];
    if (!thead || !tbody || !thead.rows.length || !tbody.rows.length) return;
    table.dataset.rqhEnhanced = '1';

    injectRQHTableStyles();

    const headerRows = Array.from(thead.rows);
    const labelRow = headerRows[0]; // human-readable column names row

    // Add a "No." cell to every header row (bump colspan on spanning rows,
    // e.g. the trailing empty <tr><td colspan="N"></td></tr> separator row).
    headerRows.forEach((tr) => {
      const firstCell = tr.cells[0];
      if (!firstCell) return;
      if (tr.cells.length === 1 && firstCell.hasAttribute('colspan')) {
        const span = parseInt(firstCell.getAttribute('colspan'), 10) || 1;
        firstCell.setAttribute('colspan', String(span + 1));
        return;
      }
      const cell = document.createElement(firstCell.tagName.toLowerCase());
      cell.className = firstCell.className;
      cell.classList.add('rqh-col-no');
      cell.textContent = tr === labelRow ? 'No.' : '';
      tr.insertBefore(cell, firstCell);
    });
    // Toggle link to show/hide the class-name/data-type metadata rows.
    const metaToggle = document.createElement('span');
    metaToggle.className = 'rqh-meta-toggle';
    metaToggle.textContent = ' [+]';
    metaToggle.title = 'Show/hide column type details';
    metaToggle.addEventListener('click', (e) => {
      e.stopPropagation(); // don't trigger the column copy-click on "No."
      const showing = table.classList.toggle('rqh-show-meta');
      metaToggle.textContent = showing ? ' [-]' : ' [+]';
    });
    labelRow.cells[0].appendChild(metaToggle);
    // Add a row-number cell to every body row.
    Array.from(tbody.rows).forEach((tr, i) => {
      const td = document.createElement('td');
      td.className = 'rqh-col-no';
      td.textContent = String(i + 1);
      tr.insertBefore(td, tr.cells[0]);
    });

    table.classList.add('rqh-report-table');

    // Wrap the table in a positioned, focusable container so we have
    // somewhere to show the copy toast and catch Ctrl+C.
    const wrap = document.createElement('div');
    wrap.className = 'rqh-report-wrap';
    wrap.tabIndex = 0;
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);

    // --- Header click-to-copy (skip the "No." column itself) ---
    Array.from(labelRow.cells).forEach((th, idx) => {
      if (idx === 0) return;
      th.setAttribute('data-rqh-copyable', '1');
      th.title = 'Click to copy this column';
      th.addEventListener('click', () => {
        const values = Array.from(tbody.rows).map((tr) => tr.cells[idx]?.textContent ?? '');
        navigator.clipboard.writeText(values.join('\n')).then(() => {
          showRQHToast(wrap, `Copied ${values.length} value(s) from "${th.textContent.trim()}"`);
        });
      });
    });

    // --- Excel-style range selection + Ctrl+C copy ---
    let anchor = null;
    let selected = new Set();
    let dragging = false;

    function cellPos(td) {
      const tr = td.parentElement;
      const col = td.cellIndex - 1; // exclude the No. column
      const row = Array.prototype.indexOf.call(tbody.rows, tr);
      return col >= 0 && row >= 0 ? { row, col } : null;
    }
    function key(r, c) {
      return r + ',' + c;
    }
    function tdAt(r, c) {
      const tr = tbody.rows[r];
      return tr ? tr.cells[c + 1] : null;
    }
    function highlight() {
      table.querySelectorAll('td.rqh-sel').forEach((td) => td.classList.remove('rqh-sel'));
      selected.forEach((k) => {
        const [r, c] = k.split(',').map(Number);
        tdAt(r, c)?.classList.add('rqh-sel');
      });
    }
    function selectRect(a, b) {
      selected.clear();
      const r1 = Math.min(a.row, b.row);
      const r2 = Math.max(a.row, b.row);
      const c1 = Math.min(a.col, b.col);
      const c2 = Math.max(a.col, b.col);
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) selected.add(key(r, c));
      }
      highlight();
    }

    tbody.addEventListener('mousedown', (e) => {
      const td = e.target.closest('td:not(.rqh-col-no)');
      if (!td) return;
      const pos = cellPos(td);
      if (!pos) return;
      e.preventDefault();
      if (e.shiftKey && anchor) {
        selectRect(anchor, pos);
      } else if (e.ctrlKey || e.metaKey) {
        const k = key(pos.row, pos.col);
        if (selected.has(k)) selected.delete(k);
        else selected.add(k);
        highlight();
        anchor = pos;
      } else {
        selected = new Set([key(pos.row, pos.col)]);
        highlight();
        anchor = pos;
        dragging = true;
      }
      wrap.focus();
    });
    tbody.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const td = e.target.closest('td:not(.rqh-col-no)');
      if (!td) return;
      const pos = cellPos(td);
      if (pos && anchor) selectRect(anchor, pos);
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
    });

    wrap.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selected.size) {
        e.preventDefault();
        const keys = Array.from(selected).map((k) => k.split(',').map(Number));
        const minR = Math.min(...keys.map((k) => k[0]));
        const maxR = Math.max(...keys.map((k) => k[0]));
        const minC = Math.min(...keys.map((k) => k[1]));
        const maxC = Math.max(...keys.map((k) => k[1]));
        const lines = [];
        for (let r = minR; r <= maxR; r++) {
          const cells = [];
          for (let c = minC; c <= maxC; c++) {
            cells.push(selected.has(key(r, c)) ? tdAt(r, c)?.textContent ?? '' : '');
          }
          lines.push(cells.join('\t'));
        }
        navigator.clipboard.writeText(lines.join('\n')).then(() => {
          showRQHToast(wrap, `Copied ${selected.size} cell(s)`);
        });
      }
    });
  }
function injectRQHResizeStyles() {
    if (document.getElementById('rqh-resize-styles')) return;
    const style = document.createElement('style');
    style.id = 'rqh-resize-styles';
    style.textContent = `
      .rqh-report-table { table-layout: fixed; }
      .rqh-report-table th { position: relative; }
      .rqh-report-table td, .rqh-report-table th {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .rqh-report-table td.rqh-expanded, .rqh-report-table th.rqh-expanded {
        white-space: normal; word-break: break-word;
      }
      .rqh-resize-handle {
        position: absolute; top: 0; right: 0; bottom: 0; width: 6px;
        cursor: col-resize; z-index: 5;
      }
      .rqh-resize-handle:hover, .rqh-resize-handle.rqh-resizing {
        background: rgba(59, 130, 246, 0.5);
      }
    `;
    document.head.appendChild(style);
  }

  // Adds a drag handle to each column header for manual resizing, and
  // double-click-to-expand (toggles text wrapping) for that column.
  function makeColumnsResizable(table) {
    if (!table || table.dataset.rqhResizable) return;
    const thead = table.tHead;
    const tbody = table.tBodies && table.tBodies[0];
    if (!thead || !tbody || !thead.rows.length) return;
    table.dataset.rqhResizable = '1';

    injectRQHResizeStyles();

    const labelRow = thead.rows[0];
    const headerCells = Array.from(labelRow.cells);

    // Snapshot current rendered widths into a <colgroup> so switching to
    // table-layout: fixed doesn't jump/collapse the columns.
    const colgroup = document.createElement('colgroup');
    headerCells.forEach((th) => {
      const col = document.createElement('col');
      col.style.width = th.getBoundingClientRect().width + 'px';
      colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, table.firstChild);
    const cols = Array.from(colgroup.children);

    headerCells.forEach((th, idx) => {
      if (th.classList.contains('rqh-col-no')) return; // skip row-number column

      const handle = document.createElement('div');
      handle.className = 'rqh-resize-handle';
      th.appendChild(handle);

      th.addEventListener('dblclick', (e) => {
        if (e.target === handle) return;
        const expand = !th.classList.contains('rqh-expanded');
        th.classList.toggle('rqh-expanded', expand);
        Array.from(tbody.rows).forEach((tr) => {
          tr.cells[idx]?.classList.toggle('rqh-expanded', expand);
        });
      });

      let startX = 0;
      let startWidth = 0;
      function onMouseMove(e) {
        const newWidth = Math.max(40, startWidth + (e.clientX - startX));
        cols[idx].style.width = newWidth + 'px';
      }
      function onMouseUp() {
        handle.classList.remove('rqh-resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX;
        startWidth = cols[idx].getBoundingClientRect().width;
        handle.classList.add('rqh-resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });
  }

  function scanAndMakeResizable() {
    document.querySelectorAll('table.report-outside').forEach(makeColumnsResizable);
  }
function csvEscape(value) {
    const str = String(value ?? '');
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }

  function downloadTableAsCsv(table) {
    const thead = table.tHead;
    const tbody = table.tBodies && table.tBodies[0];
    if (!thead || !tbody) return;

    const labelRow = thead.rows[0];
    const headers = Array.from(labelRow.cells)
      .filter((c) => !c.classList.contains('rqh-col-no'))
      .map((c) => c.textContent.trim());

    const lines = [headers.map(csvEscape).join(',')];
    Array.from(tbody.rows).forEach((tr) => {
      const cells = Array.from(tr.cells).filter((c) => !c.classList.contains('rqh-col-no'));
      lines.push(cells.map((c) => csvEscape(c.textContent.trim())).join(','));
    });

    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'query_result.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Finds each server-rendered "Download" link (href contains download=true)
  // and adds a sibling "Download CSV" link that exports the associated
  // report table client-side.
  function addCsvDownloadLinks() {
    document.querySelectorAll('a[href*="download=true"]').forEach((link) => {
      if (link.dataset.rqhCsvAdded) return;
      link.dataset.rqhCsvAdded = '1';

      let table = null;
      let node = link.closest('h3') || link;
      while (node && !table) {
        node = node.nextElementSibling;
        if (!node) break;
        table = node.matches && node.matches('table.report-outside')
          ? node
          : node.querySelector && node.querySelector('table.report-outside');
      }
      if (!table) return;

      const csvLink = document.createElement('a');
      csvLink.href = '#';
      csvLink.textContent = 'Download CSV';
      csvLink.style.fontSize = '15px';
      csvLink.style.marginLeft = '10px';
      csvLink.addEventListener('click', (e) => {
        e.preventDefault();
        downloadTableAsCsv(table);
      });
      link.parentNode.insertBefore(csvLink, link.nextSibling);
    });
  }

  function scanAndAddCsvLinks() {
    addCsvDownloadLinks();
  }
  function scanAndEnhanceReportTables() {
    document.querySelectorAll('table.report-outside').forEach(enhanceReportTable);
  }

  /* -----------------------------------------------------------------------
   * 1c. QUERY META CLEANUP
   * -------------------------------------------------------------------
   * Collapses the verbose "Query Runtime" / "Query Row Count" heading +
   * readonly-textarea + <hr> blocks (not useful to an end user) into one
   * small, unobtrusive summary line, e.g. "1572 ms · 7 rows".
   * ---------------------------------------------------------------------*/

  function injectRQHMetaStyles() {
    if (document.getElementById('rqh-meta-styles')) return;
    const style = document.createElement('style');
    style.id = 'rqh-meta-styles';
    style.textContent = `
      .rqh-query-meta {
        font-family: verdana, sans-serif;
        font-size: 11px;
        color: #888;
        margin: 4px 0 8px 0;
      }
    `;
    document.head.appendChild(style);
  }
    function injectRQHToggleStyles() {
    if (document.getElementById('rqh-toggle-styles')) return;
    const style = document.createElement('style');
    style.id = 'rqh-toggle-styles';
    style.textContent = `
      .rqh-toggle {
        position: relative;
        display: grid;
        grid-template-columns: repeat(var(--rqh-toggle-count), 1fr);
        background: #e2e5e9;
        border-radius: 999px;
        padding: 3px;
        margin: 8px 0;
        cursor: pointer;
        user-select: none;
        max-width: 320px;
      }
      .rqh-toggle-slider {
        position: absolute;
        top: 3px; left: 3px; bottom: 3px;
        width: calc((100% - 6px) / var(--rqh-toggle-count));
        border-radius: 999px;
        background: linear-gradient(135deg, #5b9bf5, #3b6fd6);
        box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        transition: transform 0.25s ease;
      }
      .rqh-toggle-option {
        position: relative;
        z-index: 1;
        text-align: center;
        padding: 7px 14px;
        font-family: verdana, sans-serif;
        font-size: 12px;
        font-weight: 600;
        color: #555;
        white-space: nowrap;
        transition: color 0.25s ease;
      }
      .rqh-toggle-option.active { color: #fff; }
    `;
    document.head.appendChild(style);
  }
/* -----------------------------------------------------------------------
 * 1d. JSON TAG VALUE PARSING
 * -------------------------------------------------------------------
 * If the result table has a "FullTagValue" column containing JSON like
 * {"sourceType":"Job","client":"0000","name":"..."}, add a parsed
 * "UC4Name" column right after it, pulling out just the `name` field.
 * ---------------------------------------------------------------------*/

function parseUc4NameColumn(table) {
  if (!table || table.dataset.rqhJsonParsed) return;
  const thead = table.tHead;
  const tbody = table.tBodies && table.tBodies[0];
  if (!thead || !tbody || !thead.rows.length) return;

  const labelRow = thead.rows[0];
  const headers = Array.from(labelRow.cells).map((c) => c.textContent.trim());
  const tagColIdx = headers.indexOf('FullTagValue');
  if (tagColIdx === -1) return; // not this kind of result set

  table.dataset.rqhJsonParsed = '1';

  // Insert a new header cell right after FullTagValue on every header row.
  Array.from(thead.rows).forEach((tr) => {
    if (tr.cells.length === 1 && tr.cells[0].hasAttribute('colspan')) {
      const cell = tr.cells[0];
      const span = parseInt(cell.getAttribute('colspan'), 10) || 1;
      cell.setAttribute('colspan', String(span + 1));
      return;
    }
    const refCell = tr.cells[tagColIdx];
    if (!refCell) return;
    const newCell = document.createElement(refCell.tagName.toLowerCase());
    newCell.className = refCell.className;
    newCell.textContent = tr === labelRow ? 'UC4Name' : '';
    if (refCell.nextSibling) {
      tr.insertBefore(newCell, refCell.nextSibling);
    } else {
      tr.appendChild(newCell);
    }
  });

  // Insert the parsed value into every body row.
  // Tag format: "Package, System, Client, UC4Name" (comma-separated,
  // UC4 name is always the LAST segment - mirrors Java's splitUC4Tag()).
  Array.from(tbody.rows).forEach((tr) => {
    const tagCell = tr.cells[tagColIdx];
    if (!tagCell) return;

    let uc4Name = '';
    const raw = tagCell.textContent.trim();
    if (raw) {
      const parts = raw.split(',').map((s) => s.trim());
      uc4Name = parts[parts.length - 1] || '';
    }

    const newCell = document.createElement('td');
    newCell.textContent = uc4Name || '(unparsed)';
    if (tagCell.nextSibling) {
      tr.insertBefore(newCell, tagCell.nextSibling);
    } else {
      tr.appendChild(newCell);
    }
  });
}
function scanAndParseUc4Names() {
  document.querySelectorAll('table.report-outside').forEach(parseUc4NameColumn);
}
  // Collects an <h3>...</h3><textarea>...</textarea>[<hr>] block: the text
  // inside the textarea, plus every node from the h3 through the trailing
  // <hr> (inclusive) so the whole thing can be removed afterward.
  function collectMetaBlock(h3) {
    const nodes = [h3];
    let text = '';
    let node = h3.nextSibling;
    while (node) {
      const next = node.nextSibling;
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'TEXTAREA') {
        text = (node.value || node.textContent || '').trim();
        nodes.push(node);
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'HR') {
        nodes.push(node);
        return { text, nodes };
      } else if (node.nodeType === Node.TEXT_NODE) {
        nodes.push(node);
      } else {
        break;
      }
      node = next;
    }
    return { text, nodes };
  }

  function compactQueryMeta() {
    const h3s = Array.from(document.querySelectorAll('h3'));
    const runtimeH3 = h3s.find((h) => h.textContent.trim() === 'Query Runtime');
    const rowCountH3 = h3s.find((h) => h.textContent.trim() === 'Query Row Count');
    if (!runtimeH3 || !rowCountH3) return;

    injectRQHMetaStyles();

    const runtimeBlock = collectMetaBlock(runtimeH3);
    const rowCountBlock = collectMetaBlock(rowCountH3);

    const msMatch = runtimeBlock.text.match(/(\d+)\s*milliseconds?/i);
    const runtimeShort = msMatch ? `${msMatch[1]} ms` : runtimeBlock.text;

    const rowMatch = rowCountBlock.text.match(/(\d+)\s*rows?/i);
    const rowCountShort = rowMatch ? `${rowMatch[1]} rows` : rowCountBlock.text;

    const summary = document.createElement('div');
    summary.className = 'rqh-query-meta';
    summary.textContent = `${runtimeShort} · ${rowCountShort}`;

    runtimeH3.parentNode.insertBefore(summary, runtimeH3);

    [...runtimeBlock.nodes, ...rowCountBlock.nodes].forEach((n) => {
      n.parentNode && n.parentNode.removeChild(n);
    });
  }

  const TAB_CONFIGS = [
    {
      id: 'free',
      label: 'Free Query',
      description: 'Write / paste any SQL directly, exactly like the default page.',
      inputLabel: null, // no extra input box - just uses the main textarea
      buildQuery: null, // null means "don't touch the textarea, just submit as-is"
    },
    {
      id: 'search-for-use',
      label: 'Search For Use',
      description:
        'Paste a list of JobDefinition names (one per line, or comma separated). ' +
        'Returns the parent JobChain(s) that reference each one as a step.',
      inputLabel: 'JobDefinition names',
      buildQuery: function (list) {
        if (list.length === 0) return null;

        const inList = sqlInList(list);
        return `SELECT jd.Name AS JobDefinitionName,
       jd1.Name AS ParentName
FROM JobDefinition jd
JOIN JobChainCall jcc
     ON jcc.JobDefinition = jd.UniqueId
JOIN JobChainStep jcs
     ON jcc.JobChainStep = jcs.UniqueId
JOIN JobChain jc
     ON jcs.JobChain = jc.UniqueId
JOIN JobDefinition jd1
     ON jc.JobDefinition = jd1.UniqueId
WHERE jd.Name IN (${inList})`;
      },
    },
    {
      id: 'list-steps',
      label: 'List Steps',
      description:
        'Paste a list of JobChain names (one per line, or comma separated). ' +
        'Returns every step (JobDefinition) contained in each chain.',
      inputLabel: 'JobChain names',
      buildQuery: function (list) {
        if (list.length === 0) return null;

        const inList = sqlInList(list);
        return `SELECT jcd.Partition AS PartitionName, jcd.Name AS ChainName, jcs.SequenceNumber AS STEP, jd.Name AS ChildName
FROM JobChain jc
JOIN JobDefinition jcd ON jcd.UniqueId = jc.JobDefinition
JOIN JobChainStep jcs ON jcs.JobChain= jc.UniqueId
JOIN JobChainCall jcc ON jcc.JobChainStep = jcs.UniqueId
JOIN JobDefinition jd ON jcc.JobDefinition = jd.UniqueId
WHERE jcd.Name IN (${inList})`;
      },
    },
{
  id: 'rmj-uc4-lookup',
  label: 'RMJ ⇄ UC4 Name',
  description:
    'Paste a list of names (one per line, or comma separated), then pick a direction. ' +
    '"RMJ → UC4" looks up each RMJ JobDefinition\'s UC4ExternalBusinessKey tag value. ' +
    '"UC4 → RMJ" finds RMJ JobDefinition(s) whose tag ends with ", <UC4Name>" ' +
    '(mirrors Jobdefinition_Minh_Test_GetRMJNameByUC4Name).',
  inputLabel: 'Names',
  toggle: {
    options: [
      { value: 'rmj-to-uc4', label: 'RMJ → UC4' },
      { value: 'uc4-to-rmj', label: 'UC4 → RMJ' },
    ],
    default: 'rmj-to-uc4',
  },
  buildQuery: function (list, rawInput, direction) {
    if (list.length === 0) return null;

    const baseSelect = `SELECT jd.Name       AS RMJName,
       jd.Partition  AS PartitionName,
       ot.Value      AS FullTagValue
FROM JobDefinition jd
JOIN ObjectTag ot
     ON ot.RefUniqueId = jd.UniqueId
JOIN ObjectTagDefinition otd
     ON otd.UniqueId = ot.ObjectTagDefinition
JOIN ObjectDefinition od
     ON od.UniqueId = ot.ObjectDefinition
WHERE otd.Name = 'UC4ExternalBusinessKey'
  AND od.ObjectName = 'JobDefinition'
  AND jd.UniqueId = jd.MasterJobDefinition`;

    if (direction === 'uc4-to-rmj') {
      // Build "(ot.Value LIKE '%, name1' OR ot.Value LIKE '%, name2' OR ...)"
      // Mirrors the Java job's likePattern = "%, " + uc4Name check.
      const likeClauses = list
        .map((v) => `ot.Value LIKE '%, ${v.replace(/'/g, "''")}'`)
        .join('\n     OR ');
      return `${baseSelect}\n  AND (${likeClauses})`;
    }

    // default: rmj-to-uc4
    const inList = sqlInList(list);
    return `${baseSelect}\n  AND jd.Name IN (${inList})`;
  },
},
{
  id: 'find-siblings',
  label: 'Find Siblings (Same UC4)',
  description:
    'Paste a list of RMJ JobDefinition names (one per line, or comma separated). ' +
    'Returns every OTHER JobDefinition sharing the exact same UC4ExternalBusinessKey ' +
    'tag value — mirrors findSiblingsByUc4Name() / the "split" pGetMultiple mode in ' +
    'Jobdefinition_Minh_Test_GetUC4NameByRmjName.',
  inputLabel: 'RMJ JobDefinition names',
  buildQuery: function (list) {
    if (list.length === 0) return null;

    const inList = sqlInList(list);
    return `SELECT src.Name       AS SourceRMJName,
       sib.Name       AS SiblingRMJName,
       sib.Partition  AS SiblingPartition,
       ot2.Value      AS SiblingFullTagValue
FROM JobDefinition src
JOIN ObjectTag ot1
     ON ot1.RefUniqueId = src.UniqueId
JOIN ObjectTagDefinition otd1
     ON otd1.UniqueId = ot1.ObjectTagDefinition
JOIN ObjectDefinition od1
     ON od1.UniqueId = ot1.ObjectDefinition
JOIN ObjectTag ot2
     ON ot2.ObjectTagDefinition = ot1.ObjectTagDefinition
    AND ot2.ObjectDefinition = ot1.ObjectDefinition
    AND ot2.Value = ot1.Value
JOIN JobDefinition sib
     ON sib.UniqueId = ot2.RefUniqueId
    AND sib.UniqueId = sib.MasterJobDefinition
WHERE otd1.Name = 'UC4ExternalBusinessKey'
  AND od1.ObjectName = 'JobDefinition'
  AND src.UniqueId = src.MasterJobDefinition
  AND sib.UniqueId <> src.UniqueId
  AND src.Name IN (${inList})
`;
  },
},

  ];

  /* -----------------------------------------------------------------------
   * 2. UI INJECTION
   * ---------------------------------------------------------------------*/

  function init() {
    const textarea = document.getElementById('queryEdit');
    const form = textarea ? textarea.closest('form') : null;
    if (!textarea || !form) {
      // Page structure not as expected - bail out quietly.
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.id = 'rqh-wrapper';
    wrapper.style.marginBottom = '10px';
    wrapper.style.fontFamily = 'verdana, sans-serif';
    wrapper.style.fontSize = '12px';

    // --- Tab bar ---
    const tabBar = document.createElement('div');
    tabBar.style.display = 'flex';
    tabBar.style.gap = '4px';
    tabBar.style.marginBottom = '6px';

    // --- Panel area (description + input + run button), one per tab ---
    const panelArea = document.createElement('div');
    panelArea.style.border = '1px solid #cccccc';
    panelArea.style.padding = '8px';
    panelArea.style.background = '#f7f7f7';

    const tabButtons = {};
    const panels = {};

    TAB_CONFIGS.forEach((cfg) => {
      // Tab button
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = cfg.label;
      btn.style.padding = '6px 12px';
      btn.style.cursor = 'pointer';
      btn.style.border = '1px solid #999';
      btn.style.background = '#e0e0e0';
      btn.dataset.tabId = cfg.id;
      btn.addEventListener('click', () => selectTab(cfg.id));
      tabBar.appendChild(btn);
      tabButtons[cfg.id] = btn;

      // Panel
      const panel = document.createElement('div');
      panel.dataset.tabId = cfg.id;
      panel.style.display = 'none';

      if (cfg.description) {
        const desc = document.createElement('div');
        desc.textContent = cfg.description;
        desc.style.marginBottom = '6px';
        desc.style.color = '#333';
        panel.appendChild(desc);
      }

      if (cfg.inputLabel) {
        const label = document.createElement('label');
        label.textContent = cfg.inputLabel + ':';
        label.style.display = 'block';
        label.style.fontWeight = 'bold';
        label.style.marginBottom = '4px';
        panel.appendChild(label);

        const input = document.createElement('textarea');
        input.rows = 5;
        input.style.width = '100%';
        input.style.fontFamily = 'monospace';
        input.placeholder = 'One value per line, or comma separated';
        panel.appendChild(input);
        panel._input = input;

        // Optional direction toggle (e.g. RMJ -> UC4 / UC4 -> RMJ) rendered
        // as a single sliding pill switch.
        let currentDirection = cfg.toggle ? cfg.toggle.default : null;
        if (cfg.toggle) {
          injectRQHToggleStyles();

          const toggleWrap = document.createElement('div');
          toggleWrap.className = 'rqh-toggle';
          toggleWrap.style.setProperty('--rqh-toggle-count', cfg.toggle.options.length);

          const slider = document.createElement('div');
          slider.className = 'rqh-toggle-slider';
          toggleWrap.appendChild(slider);

          const optionEls = {};
          cfg.toggle.options.forEach((opt) => {
            const optEl = document.createElement('div');
            optEl.className = 'rqh-toggle-option';
            optEl.textContent = opt.label;
            optEl.dataset.value = opt.value;
            optEl.addEventListener('click', () => setActive(opt.value));
            toggleWrap.appendChild(optEl);
            optionEls[opt.value] = optEl;
          });

          function setActive(value) {
            currentDirection = value;
            const idx = cfg.toggle.options.findIndex((o) => o.value === value);
            slider.style.transform = `translateX(${idx * 100}%)`;
            Object.keys(optionEls).forEach((v) => {
              optionEls[v].classList.toggle('active', v === value);
            });
          }

          panel.appendChild(toggleWrap);
          panel._getDirection = () => currentDirection;
          panel._setDirection = setActive;

          setActive(currentDirection);
        }
        const runBtn = document.createElement('button');
        runBtn.type = 'button';
        runBtn.textContent = 'Generate & Run';
        runBtn.style.marginTop = '6px';
        runBtn.style.padding = '4px 10px';
        runBtn.style.cursor = 'pointer';
        runBtn.addEventListener('click', () => {
          const list = parseList(input.value);
          const direction = panel._getDirection ? panel._getDirection() : null;
          const sql = cfg.buildQuery(list, input.value, direction);
          if (!sql) {
            alert('Please paste at least one value first.');
            return;
          }
          textarea.value = sql;
          // Remember which tab + input (+ direction) were used, since
          // form.submit() triggers a full page reload and wipes script state.
          try {
            sessionStorage.setItem(
              'rqh-active-tab',
              JSON.stringify({ id: cfg.id, inputValue: input.value, direction })
            );
          } catch (e) {
            /* sessionStorage unavailable - non-fatal, just won't restore */
          }
          form.submit();
        });
        panel.appendChild(runBtn);
      } else {
        const note = document.createElement('div');
        note.style.color = '#666';
        note.textContent = 'Edit the query box below directly, then click "Submit Query" as usual.';
        panel.appendChild(note);
      }

      panelArea.appendChild(panel);
      panels[cfg.id] = panel;
    });

    wrapper.appendChild(tabBar);
    wrapper.appendChild(panelArea);

    // Insert the whole thing just above the existing textarea.
    textarea.parentNode.insertBefore(wrapper, textarea);

    // Make the raw #queryEdit textarea collapsible (collapsed by default) -
    // end users drive things through the tabs above, not the raw SQL box.
    // On the "Free Query" tab it's the only field, so selectTab() forces
    // it open there instead of leaving it collapsed.
    const collapseCtl = makeQueryEditCollapsible(textarea);

    function selectTab(id) {
      Object.keys(panels).forEach((tid) => {
        panels[tid].style.display = tid === id ? 'block' : 'none';
        tabButtons[tid].style.background = tid === id ? '#6598CB' : '#e0e0e0';
        tabButtons[tid].style.color = tid === id ? '#fff' : '#000';
      });
      if (collapseCtl) {
        if (id === 'free') {
          collapseCtl.forceOpen();
        } else {
          collapseCtl.releaseForce();
        }
      }
    }

    // Restore whichever tab was active before the last form submit
    // (submits cause a full page reload, wiping normal script state).
    let restored = null;
    try {
      const saved = sessionStorage.getItem('rqh-active-tab');
      if (saved) restored = JSON.parse(saved);
    } catch (e) {
      /* ignore malformed/unavailable storage */
    }

    if (restored && panels[restored.id]) {
      selectTab(restored.id);
      const panel = panels[restored.id];
      if (panel._input && typeof restored.inputValue === 'string') {
        panel._input.value = restored.inputValue;
      }
      if (panel._setDirection && restored.direction) {
        panel._setDirection(restored.direction);
      }
    } else {
      // Default to the first tab.
      selectTab(TAB_CONFIGS[0].id);
    }
  }

// If we're on an un-rendered /redwood/support/query page, auto-POST an
// empty query to render it and stop here - the resulting page load will
// re-run this script with a proper #queryEdit present.
if (!ensureQueryPageRendered()) {
  init();
  scanAndEnhanceReportTables();
  compactQueryMeta();
  scanAndParseUc4Names();
  scanAndMakeResizable();
  scanAndAddCsvLinks();
  new MutationObserver(() => {
    scanAndEnhanceReportTables();
    compactQueryMeta();
    scanAndParseUc4Names();
    scanAndMakeResizable();
    scanAndAddCsvLinks();
  }).observe(document.body, {
    childList: true,
    subtree: true,
  });
}
})();
