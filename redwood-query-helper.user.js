// ==UserScript==

// @name         Redwood Support Query Helper

// @namespace    redwood-query-helper

// @version      0.10.0

// @description  Adds tabbed, reusable SQL query templates to the Redwood /redwood/support/query page (e.g. "find parent job chain for a list of job definitions").

// @match        *://*/redwood/support

// @match        *://*/redwood/support/

// @match        *://*/redwood/support/*

// @run-at       document-idle

// @grant        none

// ==/UserScript==

(function () {
  "use strict";

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
    const path = location.pathname.replace(/\/+$/, "");

    if (!/\/redwood\/support\/query$/.test(path)) return false;

    if (document.getElementById("queryEdit")) {
      // Page rendered successfully - clear the guard so a future blank

      // load (new navigation, not this one) is allowed to auto-post again.

      try {
        sessionStorage.removeItem("rqh-auto-post-attempted");
      } catch (e) {}

      return false;
    }

    const FLAG = "rqh-auto-post-attempted";

    let alreadyTried = false;

    try {
      alreadyTried = sessionStorage.getItem(FLAG) === "1";
    } catch (e) {}

    if (alreadyTried) return false;

    try {
      sessionStorage.setItem(FLAG, "1");
    } catch (e) {}

    const form = document.createElement("form");

    form.method = "POST";

    form.action = "/redwood/support/query";

    form.style.display = "none";

    const input = document.createElement("textarea");

    input.name = "query";

    input.value = "";

    form.appendChild(input);

    document.body.appendChild(form);

    form.submit();

    return true;
  }

  /* -----------------------------------------------------------------------

   * 1. TAB CONFIGURATION

   * -------------------------------------------------------------------

   * Each tab describes one "wrapper" around a complex query.

   *   id             - unique string

   *   label          - shown on the tab button

   *   description    - short help text shown above the input box

   *   inputLabel     - label for the textarea where the user pastes values

   *   secondaryInput - optional second textarea { label } for tabs that need

   *                    a second list of values (e.g. fixed pivot columns)

   *   buildQuery(list, rawInput, direction, checked, secondaryList) -> SQL string

   *       `list` is an array of trimmed, non-empty lines/tokens the user pasted

   *       `rawInput` is the untouched textarea value, in case you need it

   *       `direction` is the active toggle value, if cfg.toggle is set

   *       `checked` is the array of active checkbox values, if cfg.checkboxes is set

   *       `secondaryList` is the parsed second textarea, if cfg.secondaryInput is set

   *

   * Add new tabs by pushing more objects into TAB_CONFIGS.

   * ---------------------------------------------------------------------*/

  // Helper: turn a newline/comma separated blob into a deduped array of

  // trimmed, non-empty strings.

  function parseList(raw) {
    return Array.from(
      new Set(
        raw
          .replace(/\u00a0/g, " ") // normalize non-breaking spaces before anything else

          .split(/[\n,]/)

          .map((s) => s.trim())

          .filter((s) => s.length > 0),
      ),
    );
  }

  // Like parseList, but keeps duplicate entries and their original order.

  // Used only for the client-side reorder/placeholder logic (section 1f)

  // so that pasting the same value twice produces two rows (real or

  // placeholder) in the results, not one - the SQL IN(...) clause itself

  // still uses the deduped parseList since duplicate IN() values don't

  // change which rows come back.

  function parseListKeepDuplicates(raw) {
    return raw

      .split(/[\n,]/)

      .map((s) => s.trim())

      .filter((s) => s.length > 0);
  }

  // Helper: turn an array of strings into a SQL-safe quoted IN(...) list.

  // NOTE: naive escaping (doubles single quotes) - fine for job def names,

  // which shouldn't contain quotes, but review before use with free text.

  function sqlInList(values) {
    return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
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
    if (document.getElementById("rqh-collapse-styles")) return;

    const style = document.createElement("style");

    style.id = "rqh-collapse-styles";

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

    textarea.dataset.rqhCollapsible = "1";

    injectRQHCollapseStyles();

    let visible = false;

    try {
      visible = sessionStorage.getItem("rqh-query-visible") === "1";
    } catch (e) {
      /* sessionStorage unavailable - default to collapsed */
    }

    const toggle = document.createElement("div");

    toggle.className = "rqh-query-toggle";

    function updateLabel() {
      toggle.textContent = (visible ? "▼" : "▶") + " Raw SQL query";
    }

    updateLabel();

    textarea.classList.toggle("rqh-query-collapsed", !visible);

    textarea.parentNode.insertBefore(toggle, textarea);

    let forced = false;

    toggle.addEventListener("click", () => {
      if (forced) return; // ignore manual toggling while forced open (Free Query tab)

      visible = !visible;

      textarea.classList.toggle("rqh-query-collapsed", !visible);

      updateLabel();

      try {
        sessionStorage.setItem("rqh-query-visible", visible ? "1" : "0");
      } catch (e) {
        /* non-fatal */
      }
    });

    return {
      forceOpen() {
        forced = true;

        textarea.classList.remove("rqh-query-collapsed");

        toggle.style.display = "none";
      },

      releaseForce() {
        forced = false;

        toggle.style.display = "";

        textarea.classList.toggle("rqh-query-collapsed", !visible);

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
    if (document.getElementById("rqh-table-styles")) return;

    const style = document.createElement("style");

    style.id = "rqh-table-styles";

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
    let t = wrap.querySelector(".rqh-toast");

    if (!t) {
      t = document.createElement("div");

      t.className = "rqh-toast";

      wrap.appendChild(t);
    }

    t.textContent = msg;

    t.style.opacity = "1";

    clearTimeout(t._rqhTid);

    t._rqhTid = setTimeout(() => {
      t.style.opacity = "0";
    }, 1800);
  }

  function enhanceReportTable(table) {
    if (!table || table.dataset.rqhEnhanced) return;

    const thead = table.tHead;

    const tbody = table.tBodies && table.tBodies[0];

    if (!thead || !tbody || !thead.rows.length || !tbody.rows.length) return;

    table.dataset.rqhEnhanced = "1";

    injectRQHTableStyles();

    const headerRows = Array.from(thead.rows);

    const labelRow = headerRows[0]; // human-readable column names row

    // Add a "No." cell to every header row (bump colspan on spanning rows,

    // e.g. the trailing empty <tr><td colspan="N"></td></tr> separator row).

    headerRows.forEach((tr) => {
      const firstCell = tr.cells[0];

      if (!firstCell) return;

      if (tr.cells.length === 1 && firstCell.hasAttribute("colspan")) {
        const span = parseInt(firstCell.getAttribute("colspan"), 10) || 1;

        firstCell.setAttribute("colspan", String(span + 1));

        return;
      }

      const cell = document.createElement(firstCell.tagName.toLowerCase());

      cell.className = firstCell.className;

      cell.classList.add("rqh-col-no");

      cell.textContent = tr === labelRow ? "No." : "";

      tr.insertBefore(cell, firstCell);
    });

    // Toggle link to show/hide the class-name/data-type metadata rows.

    const metaToggle = document.createElement("span");

    metaToggle.className = "rqh-meta-toggle";

    metaToggle.textContent = " [+]";

    metaToggle.title = "Show/hide column type details";

    metaToggle.addEventListener("click", (e) => {
      e.stopPropagation(); // don't trigger the column copy-click on "No."

      const showing = table.classList.toggle("rqh-show-meta");

      metaToggle.textContent = showing ? " [-]" : " [+]";
    });

    labelRow.cells[0].appendChild(metaToggle);

    // Add a row-number cell to every body row.

    Array.from(tbody.rows).forEach((tr, i) => {
      const td = document.createElement("td");

      td.className = "rqh-col-no";

      td.textContent = String(i + 1);

      tr.insertBefore(td, tr.cells[0]);
    });

    table.classList.add("rqh-report-table");

    // Selection (drag / Ctrl+click / Ctrl+C) is handled by the shared

    // addCellSelection() helper below - it also creates the positioned,

    // focusable ".rqh-report-wrap" container used for the copy toast.

    const wrap = addCellSelection(table);

    // --- Header click-to-copy (skip the "No." column itself) ---

    Array.from(labelRow.cells).forEach((th, idx) => {
      if (idx === 0) return;

      th.setAttribute("data-rqh-copyable", "1");

      th.title = "Click to copy this column";

      th.addEventListener("click", () => {
        const values = Array.from(tbody.rows).map(
          (tr) => tr.cells[idx]?.textContent ?? "",
        );

        navigator.clipboard.writeText(values.join("\n")).then(() => {
          showRQHToast(
            wrap,
            `Copied ${values.length} value(s) from "${th.textContent.trim()}"`,
          );
        });
      });
    });
  }

  // --- Excel-style range selection (drag, Shift-click, Ctrl-click) + Ctrl+C

  // copy - shared by the flat report table (enhanceReportTable) and the

  // pivoted parameter matrix (addParameterMatrixView). Generic over which

  // table it's given: always treats each row's FIRST cell (cellIndex 0) as

  // a non-data label column to exclude from selection - the "No." column

  // on flat tables, the JobDefinitionName row-header column on the matrix -

  // rather than hardcoding the "No." column's class name, so it works

  // correctly on both without an index offset.

  function addCellSelection(table) {
    if (!table) return null;

    const tbody = table.tBodies && table.tBodies[0];

    if (!tbody || !tbody.rows.length) return table.closest(".rqh-report-wrap");

    if (table.dataset.rqhSelectable) return table.closest(".rqh-report-wrap");

    table.dataset.rqhSelectable = "1";

    injectRQHTableStyles();

    // Wrap the table in a positioned, focusable container so we have

    // somewhere to show the copy toast and catch Ctrl+C - reuse one if

    // this table is already sitting inside one.

    let wrap = table.closest(".rqh-report-wrap");

    if (!wrap) {
      wrap = document.createElement("div");

      wrap.className = "rqh-report-wrap";

      wrap.tabIndex = 0;

      table.parentNode.insertBefore(wrap, table);

      wrap.appendChild(table);
    }

    let anchor = null;

    let selected = new Set();

    let dragging = false;

    function cellPos(td) {
      const tr = td.parentElement;

      const col = td.cellIndex - 1; // exclude the leading label column

      const row = Array.prototype.indexOf.call(tbody.rows, tr);

      return col >= 0 && row >= 0 ? { row, col } : null;
    }

    function key(r, c) {
      return r + "," + c;
    }

    function tdAt(r, c) {
      const tr = tbody.rows[r];

      return tr ? tr.cells[c + 1] : null;
    }

    function highlight() {
      table
        .querySelectorAll("td.rqh-sel")
        .forEach((td) => td.classList.remove("rqh-sel"));

      selected.forEach((k) => {
        const [r, c] = k.split(",").map(Number);

        tdAt(r, c)?.classList.add("rqh-sel");
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

    tbody.addEventListener("mousedown", (e) => {
      const td = e.target.closest("td");

      if (!td || td.cellIndex === 0) return;

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

    tbody.addEventListener("mousemove", (e) => {
      if (!dragging) return;

      const td = e.target.closest("td");

      if (!td || td.cellIndex === 0) return;

      const pos = cellPos(td);

      if (pos && anchor) selectRect(anchor, pos);
    });

    document.addEventListener("mouseup", () => {
      dragging = false;
    });

    wrap.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selected.size) {
        e.preventDefault();

        const keys = Array.from(selected).map((k) => k.split(",").map(Number));

        const minR = Math.min(...keys.map((k) => k[0]));

        const maxR = Math.max(...keys.map((k) => k[0]));

        const minC = Math.min(...keys.map((k) => k[1]));

        const maxC = Math.max(...keys.map((k) => k[1]));

        const lines = [];

        for (let r = minR; r <= maxR; r++) {
          const cells = [];

          for (let c = minC; c <= maxC; c++) {
            cells.push(
              selected.has(key(r, c)) ? (tdAt(r, c)?.textContent ?? "") : "",
            );
          }

          lines.push(cells.join("\t"));
        }

        navigator.clipboard.writeText(lines.join("\n")).then(() => {
          showRQHToast(wrap, `Copied ${selected.size} cell(s)`);
        });
      }
    });

    return wrap;
  }

  function injectRQHResizeStyles() {
    if (document.getElementById("rqh-resize-styles")) return;

    const style = document.createElement("style");

    style.id = "rqh-resize-styles";

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

    table.dataset.rqhResizable = "1";

    injectRQHResizeStyles();

    const labelRow = thead.rows[0];

    const headerCells = Array.from(labelRow.cells);

    // Snapshot current rendered widths into a <colgroup> so switching to

    // table-layout: fixed doesn't jump/collapse the columns.

    const colgroup = document.createElement("colgroup");

    headerCells.forEach((th) => {
      const col = document.createElement("col");

      col.style.width = th.getBoundingClientRect().width + "px";

      colgroup.appendChild(col);
    });

    table.insertBefore(colgroup, table.firstChild);

    const cols = Array.from(colgroup.children);

    headerCells.forEach((th, idx) => {
      if (th.classList.contains("rqh-col-no")) return; // skip row-number column

      const handle = document.createElement("div");

      handle.className = "rqh-resize-handle";

      th.appendChild(handle);

      th.addEventListener("dblclick", (e) => {
        if (e.target === handle) return;

        const expand = !th.classList.contains("rqh-expanded");

        th.classList.toggle("rqh-expanded", expand);

        Array.from(tbody.rows).forEach((tr) => {
          tr.cells[idx]?.classList.toggle("rqh-expanded", expand);
        });
      });

      let startX = 0;

      let startWidth = 0;

      function onMouseMove(e) {
        const newWidth = Math.max(40, startWidth + (e.clientX - startX));

        cols[idx].style.width = newWidth + "px";
      }

      function onMouseUp() {
        handle.classList.remove("rqh-resizing");

        document.removeEventListener("mousemove", onMouseMove);

        document.removeEventListener("mouseup", onMouseUp);
      }

      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();

        e.stopPropagation();

        startX = e.clientX;

        startWidth = cols[idx].getBoundingClientRect().width;

        handle.classList.add("rqh-resizing");

        document.addEventListener("mousemove", onMouseMove);

        document.addEventListener("mouseup", onMouseUp);
      });
    });
  }

  function scanAndMakeResizable() {
    document
      .querySelectorAll("table.report-outside")
      .forEach(makeColumnsResizable);
  }

  function csvEscape(value) {
    const str = String(value ?? "");

    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }

  function downloadTableAsCsv(table) {
    const thead = table.tHead;

    const tbody = table.tBodies && table.tBodies[0];

    if (!thead || !tbody) return;

    const labelRow = thead.rows[0];

    const headers = Array.from(labelRow.cells)

      .filter((c) => !c.classList.contains("rqh-col-no"))

      .map((c) => c.textContent.trim());

    const lines = [headers.map(csvEscape).join(",")];

    Array.from(tbody.rows).forEach((tr) => {
      const cells = Array.from(tr.cells).filter(
        (c) => !c.classList.contains("rqh-col-no"),
      );

      lines.push(cells.map((c) => csvEscape(c.textContent.trim())).join(","));
    });

    const blob = new Blob([lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;

    a.download = "query_result.csv";

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

      link.dataset.rqhCsvAdded = "1";

      let table = null;

      let node = link.closest("h3") || link;

      while (node && !table) {
        node = node.nextElementSibling;

        if (!node) break;

        table =
          node.matches && node.matches("table.report-outside")
            ? node
            : node.querySelector && node.querySelector("table.report-outside");
      }

      if (!table) return;

      const csvLink = document.createElement("a");

      csvLink.href = "#";

      csvLink.textContent = "Download CSV";

      csvLink.style.fontSize = "15px";

      csvLink.style.marginLeft = "10px";

      csvLink.addEventListener("click", (e) => {
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
    document
      .querySelectorAll("table.report-outside")
      .forEach(enhanceReportTable);
  }

  /* -----------------------------------------------------------------------

   * 1c. QUERY META CLEANUP

   * -------------------------------------------------------------------

   * Collapses the verbose "Query Runtime" / "Query Row Count" heading +

   * readonly-textarea + <hr> blocks (not useful to an end user) into one

   * small, unobtrusive summary line, e.g. "1572 ms · 7 rows".

   * ---------------------------------------------------------------------*/

  function injectRQHMetaStyles() {
    if (document.getElementById("rqh-meta-styles")) return;

    const style = document.createElement("style");

    style.id = "rqh-meta-styles";

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
    if (document.getElementById("rqh-toggle-styles")) return;

    const style = document.createElement("style");

    style.id = "rqh-toggle-styles";

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

  function injectRQHCheckboxStyles() {
    if (document.getElementById("rqh-checkbox-styles")) return;

    const style = document.createElement("style");

    style.id = "rqh-checkbox-styles";

    style.textContent = `

      .rqh-checkbox-group {

        display: flex;

        flex-wrap: wrap;

        gap: 6px 14px;

        margin: 8px 0;

        font-family: verdana, sans-serif;

        font-size: 12px;

        width: 100%;

        max-height: 170px;

        overflow-y: auto;

        padding: 8px;

        border: 1px solid #ddd;

        border-radius: 4px;

        background: #fff;

        box-sizing: border-box;

      }

      .rqh-checkbox-option {

        display: inline-flex;

        align-items: center;

        gap: 4px;

        cursor: pointer;

        user-select: none;

        white-space: nowrap;

      }

      .rqh-checkbox-option input { cursor: pointer; }

      .rqh-checkbox-actions {

        font-family: verdana, sans-serif;

        font-size: 11px;

        margin: 4px 0 0 0;

      }

      .rqh-checkbox-actions a {

        color: #1a5276;

        cursor: pointer;

        text-decoration: underline;

        margin-right: 10px;

      }

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

    const tagColIdx = headers.indexOf("FullTagValue");

    if (tagColIdx === -1) return; // not this kind of result set

    table.dataset.rqhJsonParsed = "1";

    // Insert a new header cell right after FullTagValue on every header row.

    Array.from(thead.rows).forEach((tr) => {
      if (tr.cells.length === 1 && tr.cells[0].hasAttribute("colspan")) {
        const cell = tr.cells[0];

        const span = parseInt(cell.getAttribute("colspan"), 10) || 1;

        cell.setAttribute("colspan", String(span + 1));

        return;
      }

      const refCell = tr.cells[tagColIdx];

      if (!refCell) return;

      const newCell = document.createElement(refCell.tagName.toLowerCase());

      newCell.className = refCell.className;

      newCell.textContent = tr === labelRow ? "UC4Name" : "";

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

      let uc4Name = "";

      const raw = tagCell.textContent.trim();

      if (raw) {
        const parts = raw.split(",").map((s) => s.trim());

        uc4Name = parts[parts.length - 1] || "";
      }

      const newCell = document.createElement("td");

      newCell.textContent = uc4Name || "(unparsed)";

      if (tagCell.nextSibling) {
        tr.insertBefore(newCell, tagCell.nextSibling);
      } else {
        tr.appendChild(newCell);
      }
    });
  }

  function scanAndParseUc4Names() {
    document
      .querySelectorAll("table.report-outside")
      .forEach(parseUc4NameColumn);
  }

  /* -----------------------------------------------------------------------

 * 1e. WORKFLOW GRAPH VIEW (List Steps results)

 * -------------------------------------------------------------------

 * "List Steps" returns rows of (PartitionName, ChainName, SequenceNumber,

 * StepName). Reading that as a table to understand execution order is

 * tedious for chains with more than a handful of steps. This adds a

 * toggle button above the result table that renders each JobChain as a

 * left-to-right node graph (boxes = steps, arrows = sequence order),

 * wrapping to additional rows for long chains, and rendering one diagram

 * per chain if several chain names were queried at once.

 *

 * Only activates when the last-submitted tab was 'list-steps' (tracked

 * via the same 'rqh-active-tab' sessionStorage flag already used to

 * restore tab UI state after the full-page-reload form submit), so it

 * never misfires on other tabs' result tables.

 * ---------------------------------------------------------------------*/

  function injectRQHFilterStyles() {
    if (document.getElementById("rqh-filter-styles")) return;

    const style = document.createElement("style");

    style.id = "rqh-filter-styles";

    style.textContent = `

    .rqh-filter-bar { margin: 6px 0; }

    .rqh-filter-toggle-btn {

      font-family: verdana, sans-serif; font-size: 12px;

      padding: 4px 10px; cursor: pointer;

      border: 1px solid #999; background: #e0e0e0; border-radius: 3px;

    }

    .rqh-filter-toggle-btn:hover { background: #d0d0d0; }

    .rqh-filter-input-wrap {

      display: flex; align-items: center; gap: 8px; margin-top: 6px;

    }

    .rqh-filter-input {

      font-family: verdana, sans-serif; font-size: 12px;

      padding: 4px 8px; border: 1px solid #999; border-radius: 3px;

      min-width: 240px;

    }

    .rqh-filter-count {

      font-family: verdana, sans-serif; font-size: 11px; color: #666;

      white-space: nowrap;

    }

  `;

    document.head.appendChild(style);
  }

  // Adds a "Filter rows" toggle button + text input above a report table.

  // Typing filters tbody rows to those whose combined text (across all

  // columns, including the injected "No." column) contains the query,

  // case-insensitively. Purely client-side - doesn't touch the underlying

  // query - so it works the same on every tab's results, not just Search

  // Content, and composes fine with the resize/CSV/graph features below.

  function addResultFilter(table) {
    if (!table || table.dataset.rqhFilterAdded) return;

    const tbody = table.tBodies && table.tBodies[0];

    if (!tbody || !tbody.rows.length) return;

    table.dataset.rqhFilterAdded = "1";

    injectRQHFilterStyles();

    const anchor = table.closest(".rqh-report-wrap") || table;

    const bar = document.createElement("div");

    bar.className = "rqh-filter-bar";

    const btn = document.createElement("button");

    btn.type = "button";

    btn.className = "rqh-filter-toggle-btn";

    btn.textContent = "🔍 Filter rows";

    const inputWrap = document.createElement("div");

    inputWrap.className = "rqh-filter-input-wrap";

    inputWrap.style.display = "none";

    const input = document.createElement("input");

    input.type = "text";

    input.placeholder = "Filter visible rows (matches any column)…";

    input.className = "rqh-filter-input";

    const countLabel = document.createElement("span");

    countLabel.className = "rqh-filter-count";

    inputWrap.appendChild(input);

    inputWrap.appendChild(countLabel);

    const totalRows = tbody.rows.length;

    function updateCount(shown) {
      countLabel.textContent =
        shown === totalRows
          ? `${totalRows} row(s)`
          : `${shown} of ${totalRows} row(s)`;
    }

    updateCount(totalRows);

    function applyFilter() {
      const q = input.value.trim().toLowerCase();

      let shown = 0;

      Array.from(tbody.rows).forEach((tr) => {
        const match = !q || tr.textContent.toLowerCase().includes(q);

        tr.style.display = match ? "" : "none";

        if (match) shown++;
      });

      updateCount(shown);
    }

    input.addEventListener("input", applyFilter);

    btn.addEventListener("click", () => {
      const showing = inputWrap.style.display !== "none";

      inputWrap.style.display = showing ? "none" : "flex";

      btn.textContent = showing ? "🔍 Filter rows" : "🔼 Hide filter";

      if (!showing) input.focus();
    });

    bar.appendChild(btn);

    bar.appendChild(inputWrap);

    anchor.parentNode.insertBefore(bar, anchor);
  }

  function scanAndAddResultFilters() {
    document.querySelectorAll("table.report-outside").forEach(addResultFilter);
  }

  function injectRQHGraphStyles() {
    if (document.getElementById("rqh-graph-styles")) return;

    const style = document.createElement("style");

    style.id = "rqh-graph-styles";

    style.textContent = `

    .rqh-graph-toggle-btn {

      font-family: verdana, sans-serif; font-size: 12px;

      padding: 4px 10px; margin: 6px 0; cursor: pointer;

      border: 1px solid #999; background: #e0e0e0; border-radius: 3px;

    }

    .rqh-graph-toggle-btn:hover { background: #d0d0d0; }

    .rqh-graph-panel {

      display: none; margin: 8px 0 14px 0; padding: 10px;

      border: 1px solid #ccc; background: #fbfbfb; overflow-x: auto;

    }

    .rqh-graph-chain-title {

      font-family: verdana, sans-serif; font-size: 12px; font-weight: bold;

      color: #1a5276; margin: 10px 0 4px 0;

    }

    .rqh-graph-chain-title:first-child { margin-top: 0; }

  `;

    document.head.appendChild(style);
  }

  // Reads a "List Steps" result table into [{ partition, chain, steps: [{seq, name}] }],

  // grouped by (PartitionName, ChainName) and sorted by SequenceNumber.

  // Column order (ignoring the injected "No." column) is fixed by the

  // 'list-steps' SQL: PartitionName, ChainName, SequenceNumber, StepName.

  function extractChainSteps(table) {
    const thead = table.tHead;

    const tbody = table.tBodies && table.tBodies[0];

    if (!thead || !tbody || !thead.rows.length) return [];

    const labelRow = thead.rows[0];

    const dataHeaderCells = Array.from(labelRow.cells).filter(
      (c) => !c.classList.contains("rqh-col-no"),
    );

    if (dataHeaderCells.length < 4) return [];

    const groups = new Map(); // key: partition + "\u0000" + chain -> { partition, chain, steps }

    Array.from(tbody.rows).forEach((tr) => {
      const cells = Array.from(tr.cells).filter(
        (c) => !c.classList.contains("rqh-col-no"),
      );

      if (cells.length < 4) return;

      const partition = cells[0].textContent.trim();

      const chain = cells[1].textContent.trim();

      const seq = parseInt(cells[2].textContent.trim(), 10);

      const step = cells[3].textContent.trim();

      const key = partition + "\u0000" + chain;

      if (!groups.has(key)) groups.set(key, { partition, chain, steps: [] });

      groups.get(key).steps.push({ seq: isNaN(seq) ? 0 : seq, name: step });
    });

    const result = Array.from(groups.values());

    result.forEach((g) => g.steps.sort((a, b) => a.seq - b.seq));

    return result;
  }

  // Renders one chain as an SVG node graph. Steps sharing the same

  // SequenceNumber run in parallel in RMJ/UC4, so they're grouped into one

  // COLUMN (stacked vertically) rather than placed one after another;

  // distinct sequence numbers become successive columns left-to-right.

  // Arrows fan from every node in a column to every node in the next column,

  // since (absent explicit branch/condition data) each step in a column

  // depends on the whole previous column completing.

  function buildChainSvg(chain) {
    const NODE_W = 160,
      NODE_H = 44,
      GAP_X = 70,
      GAP_Y = 16,
      PAD = 12;

    const SVG_NS = "http://www.w3.org/2000/svg";

    // Group steps by SequenceNumber, preserving ascending seq order. Steps

    // within a column keep their original (stable-sorted) relative order.

    const bySeq = new Map();

    chain.steps.forEach((step) => {
      if (!bySeq.has(step.seq)) bySeq.set(step.seq, []);

      bySeq.get(step.seq).push(step);
    });

    const columns = Array.from(bySeq.keys())

      .sort((a, b) => a - b)

      .map((seq) => ({ seq, steps: bySeq.get(seq) }));

    const maxRows = Math.max(1, ...columns.map((c) => c.steps.length));

    const width = PAD * 2 + columns.length * (NODE_W + GAP_X) - GAP_X;

    const height = PAD * 2 + maxRows * (NODE_H + GAP_Y) - GAP_Y;

    const svg = document.createElementNS(SVG_NS, "svg");

    svg.setAttribute(
      "viewBox",
      `0 0 ${Math.max(width, 200)} ${Math.max(height, NODE_H + PAD * 2)}`,
    );

    svg.setAttribute("width", Math.max(width, 200));

    svg.setAttribute("height", Math.max(height, NODE_H + PAD * 2));

    svg.style.display = "block";

    svg.style.marginBottom = "6px";

    const defs = document.createElementNS(SVG_NS, "defs");

    const marker = document.createElementNS(SVG_NS, "marker");

    marker.setAttribute(
      "id",
      "rqh-arrow-" + Math.random().toString(36).slice(2),
    );

    marker.setAttribute("markerWidth", "8");

    marker.setAttribute("markerHeight", "8");

    marker.setAttribute("refX", "7");

    marker.setAttribute("refY", "4");

    marker.setAttribute("orient", "auto");

    const arrowPath = document.createElementNS(SVG_NS, "path");

    arrowPath.setAttribute("d", "M0,0 L8,4 L0,8 Z");

    arrowPath.setAttribute("fill", "#6598CB");

    marker.appendChild(arrowPath);

    defs.appendChild(marker);

    svg.appendChild(defs);

    const arrowMarkerUrl = `url(#${marker.id})`;

    // Precompute each column's x and each node's y (vertically centered

    // within the column when it has fewer nodes than the tallest column).

    const innerHeight = height - PAD * 2;

    columns.forEach((col, ci) => {
      col.x = PAD + ci * (NODE_W + GAP_X);

      const colHeight = col.steps.length * (NODE_H + GAP_Y) - GAP_Y;

      const yStart = PAD + (innerHeight - colHeight) / 2;

      col.ys = col.steps.map((_, ri) => yStart + ri * (NODE_H + GAP_Y));
    });

    // Fan arrows from every node in column i-1 to every node in column i.

    for (let ci = 1; ci < columns.length; ci++) {
      const prev = columns[ci - 1];

      const cur = columns[ci];

      prev.ys.forEach((py) => {
        const px = prev.x + NODE_W;

        const pcy = py + NODE_H / 2;

        cur.ys.forEach((cy) => {
          const cx = cur.x;

          const ccy = cy + NODE_H / 2;

          if (pcy === ccy) {
            const line = document.createElementNS(SVG_NS, "line");

            line.setAttribute("x1", px);
            line.setAttribute("y1", pcy);

            line.setAttribute("x2", cx);
            line.setAttribute("y2", ccy);

            line.setAttribute("stroke", "#6598CB");
            line.setAttribute("stroke-width", "1.5");

            line.setAttribute("marker-end", arrowMarkerUrl);

            svg.appendChild(line);
          } else {
            // Gentle curve so fan-out/fan-in lines between parallel nodes

            // don't overlap straight through other boxes.

            const midX = (px + cx) / 2;

            const path = document.createElementNS(SVG_NS, "path");

            path.setAttribute(
              "d",
              `M${px},${pcy} C${midX},${pcy} ${midX},${ccy} ${cx},${ccy}`,
            );

            path.setAttribute("stroke", "#6598CB");
            path.setAttribute("stroke-width", "1.5");
            path.setAttribute("fill", "none");

            path.setAttribute("marker-end", arrowMarkerUrl);

            svg.appendChild(path);
          }
        });
      });
    }

    // Draw nodes on top of the arrows.

    columns.forEach((col) => {
      col.steps.forEach((step, ri) => {
        const x = col.x;

        const y = col.ys[ri];

        const rect = document.createElementNS(SVG_NS, "rect");

        rect.setAttribute("x", x);
        rect.setAttribute("y", y);

        rect.setAttribute("width", NODE_W);
        rect.setAttribute("height", NODE_H);

        rect.setAttribute("rx", 6);

        rect.setAttribute("fill", "#eaf2fb");
        rect.setAttribute("stroke", "#6598CB");
        rect.setAttribute("stroke-width", "1.5");

        svg.appendChild(rect);

        const badge = document.createElementNS(SVG_NS, "text");

        badge.setAttribute("x", x + 6);
        badge.setAttribute("y", y + 13);

        badge.setAttribute("font-size", "9");
        badge.setAttribute("fill", "#6598CB");

        badge.setAttribute("font-family", "verdana, sans-serif");
        badge.setAttribute("font-weight", "bold");

        badge.textContent = `#${step.seq}`;

        svg.appendChild(badge);

        const label = document.createElementNS(SVG_NS, "text");

        label.setAttribute("x", x + NODE_W / 2);
        label.setAttribute("y", y + NODE_H / 2 + 9);

        label.setAttribute("text-anchor", "middle");
        label.setAttribute("font-size", "10.5");

        label.setAttribute("font-family", "verdana, sans-serif");
        label.setAttribute("fill", "#0e2f44");

        const maxChars = 24;

        label.textContent =
          step.name.length > maxChars
            ? step.name.slice(0, maxChars - 1) + "…"
            : step.name;

        const titleEl = document.createElementNS(SVG_NS, "title");

        titleEl.textContent = step.name;

        label.appendChild(titleEl);

        svg.appendChild(label);
      });
    });

    return svg;
  }

  function addWorkflowGraphView(table) {
    if (!table || table.dataset.rqhGraphAdded) return;

    let activeTabId = null;

    try {
      const saved = sessionStorage.getItem("rqh-active-tab");

      if (saved) activeTabId = JSON.parse(saved).id;
    } catch (e) {
      /* ignore malformed/unavailable storage */
    }

    if (activeTabId !== "list-steps") return;

    const chains = extractChainSteps(table);

    if (!chains.length) return;

    table.dataset.rqhGraphAdded = "1";

    injectRQHGraphStyles();

    const btn = document.createElement("button");

    btn.type = "button";

    btn.className = "rqh-graph-toggle-btn";

    btn.textContent = "🔀 Show as workflow diagram";

    const panel = document.createElement("div");

    panel.className = "rqh-graph-panel";

    let built = false;

    btn.addEventListener("click", () => {
      const showing = panel.style.display === "block";

      if (!showing && !built) {
        chains.forEach((chain) => {
          const title = document.createElement("div");

          title.className = "rqh-graph-chain-title";

          title.textContent = `${chain.chain} (${chain.partition}) — ${chain.steps.length} step(s)`;

          panel.appendChild(title);

          panel.appendChild(buildChainSvg(chain));
        });

        built = true;
      }

      panel.style.display = showing ? "none" : "block";

      btn.textContent = showing
        ? "🔀 Show as workflow diagram"
        : "🔼 Hide workflow diagram";
    });

    const anchor = table.closest(".rqh-report-wrap") || table;

    anchor.parentNode.insertBefore(btn, anchor);

    anchor.parentNode.insertBefore(panel, anchor);
  }

  function scanAndAddGraphViews() {
    document
      .querySelectorAll("table.report-outside")
      .forEach(addWorkflowGraphView);
  }

  /* -----------------------------------------------------------------------

   * 1g. PARAMETER MATRIX VIEW (List Parameters results, client-side pivot)

   * -------------------------------------------------------------------

   * "List Parameters" returns long-format rows (JobDefinitionName,

   * ParameterName, Value). Reading that as a flat list to spot which

   * JobDefinitions have/lack a given parameter is tedious. This adds a

   * pivoted matrix view: one row per JobDefinitionName, one column per

   * distinct ParameterName seen in the result set (no need to know

   * parameter names up front - SQL can't pivot on an open column set, but

   * JS can build the table after the fact). Only activates when the

   * last-submitted tab was 'list-parameters', same gating pattern as the

   * workflow graph view.

   *

   * The matrix is now the DEFAULT view for this tab: it's built and shown

   * immediately, with the flat server-rendered table hidden underneath it.

   * A toggle button flips back to the flat table if that's ever needed.

   * ---------------------------------------------------------------------*/

  function injectRQHMatrixStyles() {
    if (document.getElementById("rqh-matrix-styles")) return;

    const style = document.createElement("style");

    style.id = "rqh-matrix-styles";

    style.textContent = `

      .rqh-matrix-toggle-btn {

        font-family: verdana, sans-serif; font-size: 12px;

        padding: 4px 10px; margin: 6px 0; cursor: pointer;

        border: 1px solid #999; background: #e0e0e0; border-radius: 3px;

      }

      .rqh-matrix-toggle-btn:hover { background: #d0d0d0; }

      .rqh-matrix-panel {

        display: none; position: relative; margin: 8px 0 14px 0; overflow: auto;

        max-height: 70vh;

      }

      /* The matrix <table> itself uses the site's own "report-outside" class

         for borders/fonts/colors so it reads as a normal result table rather

         than a separate custom widget - only the behaviors a plain report

         table doesn't need (sticky header/first column while scrolling a

         wide pivoted grid, truncation + tooltip on long values, and dimming

         genuinely-missing cells) are layered on top here. */

      .rqh-matrix-table th, .rqh-matrix-table td {

        white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis;

      }

      .rqh-matrix-table th {

        position: sticky; top: 0; z-index: 2; background: #f7f7f7;

      }

      .rqh-matrix-table td.rqh-matrix-rowhead {

        position: sticky; left: 0; z-index: 1; background: #f7f7f7; font-weight: bold;

      }

      .rqh-matrix-table th.rqh-matrix-corner {

        left: 0; z-index: 3;

      }

      .rqh-matrix-table th[data-rqh-copyable] { cursor: pointer; }

      .rqh-matrix-table th[data-rqh-copyable]:hover { background: #e0e0e0; }

      .rqh-matrix-table td.rqh-matrix-empty { color: #bbb; }

      .rqh-matrix-csv-link {

        font-family: verdana, sans-serif; font-size: 11px;

        margin: 0 0 6px 0; display: inline-block; cursor: pointer;

        color: #1a5276; text-decoration: underline;

      }

    `;

    document.head.appendChild(style);
  }

  // Reads a "List Parameters" result table into [{ jd, param, value }],

  // matching columns by header text (not fixed index) so this keeps

  // working even if the SELECT's column order ever changes.

  function extractParameterRows(table) {
    const thead = table.tHead;

    const tbody = table.tBodies && table.tBodies[0];

    if (!thead || !tbody || !thead.rows.length) return [];

    const labelRow = thead.rows[0];

    const headers = Array.from(labelRow.cells)

      .filter((c) => !c.classList.contains("rqh-col-no"))

      .map((c) => c.textContent.trim());

    const jdIdx = headers.indexOf("JobDefinitionName");

    const paramIdx = headers.indexOf("ParameterName");

    const valIdx = headers.indexOf("Value");

    if (jdIdx === -1 || paramIdx === -1 || valIdx === -1) return []; // not this kind of result set

    const rows = [];

    Array.from(tbody.rows).forEach((tr) => {
      const cells = Array.from(tr.cells).filter(
        (c) => !c.classList.contains("rqh-col-no"),
      );

      if (cells.length <= Math.max(jdIdx, paramIdx, valIdx)) return;

      rows.push({
        jd: cells[jdIdx].textContent.trim(),

        param: cells[paramIdx].textContent.trim(),

        value: cells[valIdx].textContent.trim(),
      });
    });

    return rows;
  }

  // Pivots long-format rows into { jdOrder, paramOrder, cellMap } so the

  // same pivoted data can back both the rendered <table> and CSV export.

  function pivotParameterRows(rows) {
    const jdOrder = [];

    const jdSeen = new Set();

    const paramOrder = [];

    const paramSeen = new Set();

    const cellMap = new Map(); // "jd\u0000param" -> value

    rows.forEach(({ jd, param, value }) => {
      if (!jdSeen.has(jd)) {
        jdSeen.add(jd);
        jdOrder.push(jd);
      }

      if (!paramSeen.has(param)) {
        paramSeen.add(param);
        paramOrder.push(param);
      }

      cellMap.set(jd + "\u0000" + param, value);
    });

    return { jdOrder, paramOrder, cellMap };
  }

  // Builds the visible matrix <table> element from pivoted data. Missing

  // (JobDefinition, Parameter) combos render as a dimmed blank cell rather

  // than being silently omitted, so gaps are visually obvious.

  function buildMatrixTable(pivot) {
    const { jdOrder, paramOrder, cellMap } = pivot;

    const table = document.createElement("table");

    // "report-outside" is the site's own result-table class, so the

    // matrix inherits the same borders/fonts/colors as every other

    // report on this page instead of looking like a separate widget.

    // Also tag it with "rqh-report-table" so the truncate/expand CSS

    // (scoped to that class) applies here too.

    table.className = "report-outside rqh-matrix-table rqh-report-table";

    // This table shares the "report-outside" class purely for CSS

    // inheritance - it is NOT a raw query-result table and must never be

    // swept up by the generic scanners (enhanceReportTable,

    // parseUc4NameColumn, addWorkflowGraphView, addResultFilter). If one

    // of those runs on it later (e.g. re-triggered by the

    // MutationObserver the moment this table is inserted into the DOM),

    // it will prepend/insert extra columns (like the "No." column)

    // *after* addMatrixHeaderCopy()/makeColumnsResizable() have already

    // bound their click/dblclick handlers to the original column

    // indices - silently shifting every interaction on this table off

    // by one column. Pre-marking these flags opts it out for good.

    table.dataset.rqhEnhanced = "1";

    table.dataset.rqhJsonParsed = "1";

    table.dataset.rqhGraphAdded = "1";

    table.dataset.rqhFilterAdded = "1";

    table.dataset.rqhReordered = "1";

    const thead = document.createElement("thead");

    const headRow = document.createElement("tr");

    const corner = document.createElement("th");

    corner.textContent = "JobDefinitionName";

    corner.className = "rqh-matrix-corner";

    headRow.appendChild(corner);

    paramOrder.forEach((p) => {
      const th = document.createElement("th");

      th.textContent = p;

      th.setAttribute("data-rqh-copyable", "1");

      th.title = "Click to copy this column";

      headRow.appendChild(th);
    });

    thead.appendChild(headRow);

    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    jdOrder.forEach((jd) => {
      const tr = document.createElement("tr");

      const nameTd = document.createElement("td");

      nameTd.textContent = jd;

      nameTd.className = "rqh-matrix-rowhead";

      tr.appendChild(nameTd);

      paramOrder.forEach((p) => {
        const td = document.createElement("td");

        const v = cellMap.get(jd + "\u0000" + p);

        if (v == null) {
          td.classList.add("rqh-matrix-empty");

          td.textContent = "";
        } else {
          td.textContent = v;

          td.title = v; // full value on hover, since cells are truncated
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);

    return table;
  }

  // Click-to-copy on matrix column headers, same interaction and toast as

  // the flat report table's header click-to-copy (skips the corner cell,

  // which labels the sticky JobDefinitionName column rather than data).

  function addMatrixHeaderCopy(table, toastAnchor) {
    const thead = table.tHead;

    const tbody = table.tBodies && table.tBodies[0];

    if (!thead || !tbody) return;

    Array.from(thead.rows[0].cells).forEach((th, idx) => {
      if (idx === 0) return; // corner cell - not a data column

      th.addEventListener("click", () => {
        const values = Array.from(tbody.rows).map(
          (tr) => tr.cells[idx]?.textContent ?? "",
        );

        navigator.clipboard.writeText(values.join("\n")).then(() => {
          showRQHToast(
            toastAnchor,
            `Copied ${values.length} value(s) from "${th.textContent.trim()}"`,
          );
        });
      });
    });
  }

  function downloadMatrixAsCsv(pivot) {
    const { jdOrder, paramOrder, cellMap } = pivot;

    const lines = [
      ["JobDefinitionName", ...paramOrder].map(csvEscape).join(","),
    ];

    jdOrder.forEach((jd) => {
      const row = [
        jd,
        ...paramOrder.map((p) => cellMap.get(jd + "\u0000" + p) ?? ""),
      ];

      lines.push(row.map(csvEscape).join(","));
    });

    const blob = new Blob([lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;

    a.download = "parameter_matrix.csv";

    document.body.appendChild(a);

    a.click();

    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  function addParameterMatrixView(table) {
    if (!table || table.dataset.rqhMatrixAdded) return;

    const state = getSavedTabState();

    if (!state || state.id !== "list-parameters") return;

    const rows = extractParameterRows(table);

    if (!rows.length) return;

    table.dataset.rqhMatrixAdded = "1";

    injectRQHMatrixStyles();

    const btn = document.createElement("button");

    btn.type = "button";

    btn.className = "rqh-matrix-toggle-btn";

    const panel = document.createElement("div");

    panel.className = "rqh-matrix-panel";

    const pivot = pivotParameterRows(rows);

    const csvLink = document.createElement("a");

    csvLink.href = "#";

    csvLink.className = "rqh-matrix-csv-link";

    csvLink.textContent = "⬇ Download matrix as CSV";

    csvLink.addEventListener("click", (e) => {
      e.preventDefault();

      downloadMatrixAsCsv(pivot);
    });

    const wrap = document.createElement("div");

    wrap.style.padding = "8px";

    wrap.appendChild(csvLink);

    wrap.appendChild(document.createElement("br"));

    const matrixTable = buildMatrixTable(pivot);

    wrap.appendChild(matrixTable);

    panel.appendChild(wrap);

    const anchor = table.closest(".rqh-report-wrap") || table;

    // Matrix is the default view: show it immediately and hide the flat

    // server-rendered table underneath. The toggle button flips back to

    // the raw rows if that's ever needed.

    panel.style.display = "block";

    anchor.style.display = "none";

    btn.textContent = "🔼 Hide matrix (show raw rows)";

    btn.addEventListener("click", () => {
      const showingMatrix = panel.style.display === "block";

      panel.style.display = showingMatrix ? "none" : "block";

      anchor.style.display = showingMatrix ? "" : "none";

      btn.textContent = showingMatrix
        ? "⊞ Show as matrix"
        : "🔼 Hide matrix (show raw rows)";
    });

    anchor.parentNode.insertBefore(btn, anchor);

    anchor.parentNode.insertBefore(panel, anchor);

    // IMPORTANT: panel must already be attached to the document before

    // wiring up header-copy/resize/selection below - makeColumnsResizable

    // measures column widths via getBoundingClientRect(), which returns 0

    // for a still-detached element. Measuring 0-width columns and then

    // applying table-layout:fixed collapses every data column's clickable

    // area to ~nothing, right next to the sticky row-header column - single

    // clicks still land on *some* cell, but shift/ctrl-click and drag

    // range-selection across distinct columns becomes unreliable.

    addMatrixHeaderCopy(matrixTable, panel);

    makeColumnsResizable(matrixTable);

    addCellSelection(matrixTable);
  }

  function scanAndAddParameterMatrix() {
    document
      .querySelectorAll("table.report-outside")
      .forEach(addParameterMatrixView);
  }

  // Collects an <h3>...</h3><textarea>...</textarea>[<hr>] block: the text

  // inside the textarea, plus every node from the h3 through the trailing

  // <hr> (inclusive) so the whole thing can be removed afterward.

  function collectMetaBlock(h3) {
    const nodes = [h3];

    let text = "";

    let node = h3.nextSibling;

    while (node) {
      const next = node.nextSibling;

      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "TEXTAREA") {
        text = (node.value || node.textContent || "").trim();

        nodes.push(node);
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "HR") {
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
    const h3s = Array.from(document.querySelectorAll("h3"));

    const runtimeH3 = h3s.find((h) => h.textContent.trim() === "Query Runtime");

    const rowCountH3 = h3s.find(
      (h) => h.textContent.trim() === "Query Row Count",
    );

    if (!runtimeH3 || !rowCountH3) return;

    injectRQHMetaStyles();

    const runtimeBlock = collectMetaBlock(runtimeH3);

    const rowCountBlock = collectMetaBlock(rowCountH3);

    const msMatch = runtimeBlock.text.match(/(\d+)\s*milliseconds?/i);

    const runtimeShort = msMatch ? `${msMatch[1]} ms` : runtimeBlock.text;

    const rowMatch = rowCountBlock.text.match(/(\d+)\s*rows?/i);

    const rowCountShort = rowMatch ? `${rowMatch[1]} rows` : rowCountBlock.text;

    const summary = document.createElement("div");

    summary.className = "rqh-query-meta";

    summary.textContent = `${runtimeShort} · ${rowCountShort}`;

    runtimeH3.parentNode.insertBefore(summary, runtimeH3);

    [...runtimeBlock.nodes, ...rowCountBlock.nodes].forEach((n) => {
      n.parentNode && n.parentNode.removeChild(n);
    });
  }

  /* -----------------------------------------------------------------------

 * 1f. RESULT ROW REORDERING (match pasted input order)

 * -------------------------------------------------------------------

 * The DB returns rows in join/scan order, not the order names were pasted

 * in. For the "paste a list, look each one up" tabs, re-sort the result

 * rows client-side to match that original order. Runs BEFORE the other

 * enhancers (No. column, UC4Name column) so column indices below refer to

 * the raw server-rendered table.

 * ---------------------------------------------------------------------*/

  function parseUc4NameFromRaw(raw) {
    raw = (raw || "").trim();

    if (!raw) return null;

    const parts = raw.split(",").map((s) => s.trim());

    return parts[parts.length - 1] || null;
  }

  // tabId -> (direction) => { keyFn: (cells[]) => key string|null, placeholderColIdx: number }

  // keyFn extracts the value to match against the pasted input list from a row's

  // cells (raw server columns, before the "No." column is injected).

  // placeholderColIdx is which column of a synthesized "no match" row should

  // hold the original pasted value - normally the same column keyFn reads from,

  // except where the match key is *derived* (e.g. parsed out of FullTagValue)

  // rather than a literal column, in which case placeholderColIdx points at

  // that source column instead so the placeholder still reads sensibly.

  const REORDER_CONFIGS = {
    "search-for-use": () => ({
      keyFn: (cells) => cells[0]?.textContent.trim() || null, // JobDefinitionName

      placeholderColIdx: 0,
    }),

    "list-steps": () => ({
      keyFn: (cells) => cells[1]?.textContent.trim() || null, // ChainName

      placeholderColIdx: 1,
    }),

    "find-siblings": () => ({
      keyFn: (cells) => cells[0]?.textContent.trim() || null, // SourceRMJName

      placeholderColIdx: 0,
    }),

    "list-parameters": () => ({
      keyFn: (cells) => cells[0]?.textContent.trim() || null, // JobDefinitionName

      placeholderColIdx: 0,
    }),

    "rmj-uc4-lookup": (direction) => {
      if (direction === "uc4-to-rmj") {
        return {
          keyFn: (cells) => parseUc4NameFromRaw(cells[2]?.textContent), // FullTagValue -> last segment

          placeholderColIdx: 2, // FullTagValue column - closest sensible slot for a derived key
        };
      }

      return {
        keyFn: (cells) => cells[0]?.textContent.trim() || null, // RMJName

        placeholderColIdx: 0,
      };
    },
  };

  function getSavedTabState() {
    try {
      const saved = sessionStorage.getItem("rqh-active-tab");

      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  }

  function injectRQHNoMatchStyles() {
    if (document.getElementById("rqh-nomatch-styles")) return;

    const style = document.createElement("style");

    style.id = "rqh-nomatch-styles";

    style.textContent = `

      table.report-outside tr.rqh-no-match-row td {

        color: #999;

        font-style: italic;

        background: #fbecec !important;

      }

    `;

    document.head.appendChild(style);
  }

  function parseListKeepDuplicates(raw) {
    if (!raw || !raw.trim()) return [];

    return raw

      .split(/[\n,]/)

      .map((s) => s.trim()); // no longer filters out '' entries
  }

  function scanAndReorderRows() {
    const state = getSavedTabState();

    if (!state || !state.id) return;

    const cfgFn = REORDER_CONFIGS[state.id];

    if (!cfgFn) return; // 'free' and 'search-content' intentionally left alone

    const { keyFn, placeholderColIdx } = cfgFn(state.direction) || {};

    if (!keyFn) return;

    // Duplicates in the pasted input are preserved here (the SQL IN(...)

    // clause itself was built from the deduped list, since duplicate IN()

    // values don't change which DB rows come back) - if the user pasted the

    // same name twice, they want it to appear twice in the results too, at

    // the positions they pasted it.

    const orderedList = parseListKeepDuplicates(state.inputValue || "");

    if (!orderedList.length) return;

    document.querySelectorAll("table.report-outside").forEach((table) => {
      if (table.dataset.rqhReordered) return;

      const thead = table.tHead;

      const tbody = table.tBodies && table.tBodies[0];

      if (!thead || !tbody || !thead.rows.length || !tbody.rows.length) return;

      table.dataset.rqhReordered = "1";

      // Raw server column count (No./UC4Name columns haven't been injected

      // yet - this runs before enhanceReportTable/parseUc4NameColumn).

      const numCols = thead.rows[0].cells.length;

      // Group the DB rows returned by key. A key can map to more than one

      // row for one-to-many tabs (e.g. Search For Use: one JobDefinition

      // can be used by several parent JobChains).

      const buckets = new Map(); // exact key text -> tr[]

      Array.from(tbody.rows).forEach((tr) => {
        const key = keyFn(Array.from(tr.cells));

        if (key == null) return;

        if (!buckets.has(key)) buckets.set(key, []);

        buckets.get(key).push(tr);
      });

      function findBucketKey(value) {
        if (buckets.has(value)) return value;

        const lower = value.toLowerCase();

        for (const k of buckets.keys()) {
          if (k.toLowerCase() === lower) return k;
        }

        return null;
      }

      let anyNoMatch = false;

      const usedCount = new Map(); // bucket key -> how many pasted occurrences already emitted

      const finalRows = [];

      orderedList.forEach((value) => {
        if (value === "") {
          // Pasted blank line - render an empty spacer row so row position

          // still lines up with the pasted input, without flagging it as

          // a failed lookup.

          const tr = document.createElement("tr");

          for (let c = 0; c < numCols; c++) {
            tr.appendChild(document.createElement("td"));
          }

          finalRows.push(tr);

          return;
        }

        const bucketKey = findBucketKey(value);

        if (bucketKey) {
          const bucketRows = buckets.get(bucketKey);

          const timesUsed = usedCount.get(bucketKey) || 0;

          // First occurrence reuses the real DOM row(s); repeat pastes

          // of the same value clone them, since a DOM node can only

          // live in one place at a time.

          bucketRows.forEach((tr) => {
            finalRows.push(timesUsed === 0 ? tr : tr.cloneNode(true));
          });

          usedCount.set(bucketKey, timesUsed + 1);
        } else {
          anyNoMatch = true;

          const tr = document.createElement("tr");

          tr.classList.add("rqh-no-match-row");

          for (let c = 0; c < numCols; c++) {
            const td = document.createElement("td");

            if (c === placeholderColIdx) td.textContent = value;

            tr.appendChild(td);
          }

          finalRows.push(tr);
        }
      });

      // Safety net: if a DB row's key never matched anything in the pasted

      // list (shouldn't normally happen, since the IN() clause comes from

      // this same list, but could in edge cases like whitespace/case

      // quirks), keep it visible rather than silently dropping it.

      buckets.forEach((bucketRows, key) => {
        if (usedCount.has(key)) return;

        bucketRows.forEach((tr) => finalRows.push(tr));
      });

      if (anyNoMatch) injectRQHNoMatchStyles();

      finalRows.forEach((tr) => tbody.appendChild(tr));
    });
  }

  // Helper: build "(col LIKE '%term1%' OR col LIKE '%term2%' OR ...)" across

  // all pasted search terms. Same naive quote-escaping as sqlInList - fine

  // for typical search words, but review before use with arbitrary free text.

  function sqlLikeAny(column, terms) {
    return (
      "(" +
      terms
        .map((t) => `${column} LIKE '%${t.replace(/'/g, "''")}%'`)
        .join(" OR ") +
      ")"
    );
  }

  // Full set of known List Parameters checkbox names. ABAP_PROGRAM_NAME and

  // ABAP_VARIANT_NAME are ticked by default; everything else starts unticked

  // so the results/matrix stay focused unless more columns are asked for.

  const LIST_PARAMETERS_NAMES = [
    "ABAP_PROGRAM_NAME",

    "ABAP_VARIANT_NAME",

    "ARCHIVE_ARCTEXT",

    "ARCHIVE_AR_OBJECT",

    "ARCHIVE_INFO",

    "ARCHIVE_SAP_OBJECT",

    "CLIENT",

    "DELETE_JOB",

    "DRAFT_MODE",

    "EMAIL_ADDRESS",

    "IGNORE_APPL_RC",

    "JOBCLASS",

    "JOBCOUNT",

    "JOBNAME",

    "LANGUAGE",

    "NO_FRAME",

    "NO_SHADE",

    "PAGE_ORIENTATION",

    "PRINT_ARMOD",

    "PRINT_FOOTL",

    "PRINT_LICT",

    "PRINT_LISZ",

    "PRINT_PAART",

    "PRINT_PDEST",

    "PRINT_PEXPI",

    "PRINT_PLIST",

    "PRINT_PRABT",

    "PRINT_PRBER",

    "PRINT_PRBIG",

    "PRINT_PRCOP",

    "PRINT_PRDSN",

    "PRINT_PRIMM",

    "PRINT_PRNEW",

    "PRINT_PRREC",

    "PRINT_PRREL",

    "PRINT_PRSAP",

    "PRINT_PRTXT",

    "PRINT_PRUNX",

    "PRINT_PTYPE",

    "REC_BLIND_COPY",

    "REC_COPY",

    "REC_DELIVER",

    "REC_EXPRESS",

    "REC_MAILSTATUS",

    "REC_NO_FORWARDING",

    "REC_NO_PRINT",

    "REC_RECIPIENT",

    "REC_TYPE",

    "SAP_SYSTEMS",

    "SAP_USER_NAME",

    "SHOWAPPLLOG",

    "SHOWLOG",

    "SHOWSPOOL",

    "SMS",

    "TARGET_GROUP",

    "TARGET_SERVER",

    "TEMPORARY_VARIANT",
  ];

  const LIST_PARAMETERS_DEFAULT_CHECKED = new Set([
    "ABAP_PROGRAM_NAME",
    "ABAP_VARIANT_NAME",
  ]);

  const TAB_CONFIGS = [
    {
      id: "free",

      label: "Free Query",

      description:
        "Write / paste any SQL directly, exactly like the default page.",

      inputLabel: null, // no extra input box - just uses the main textarea

      buildQuery: null, // null means "don't touch the textarea, just submit as-is"
    },

    {
      id: "search-for-use",

      label: "Search For Use",

      description:
        "Paste a list of JobDefinition names (one per line, or comma separated). " +
        "Returns the parent JobChain(s) that reference each one as a step.",

      inputLabel: "JobDefinition names",

      buildQuery: function (list) {
        if (list.length === 0) return null;

        const inList = sqlInList(list);

        return `SELECT DISTINCT jd.Name AS JobDefinitionName,

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

WHERE jd.Name IN (${inList})

  AND jd.BranchedLLPVersion = -1

  AND jd1.BranchedLLPVersion = -1`;
      },
    },

    {
      id: "list-steps",

      label: "List Steps",

      description:
        "Paste a list of JobChain names (one per line, or comma separated). " +
        "Returns every step (JobDefinition) contained in each chain.",

      inputLabel: "JobChain names",

      buildQuery: function (list) {
        if (list.length === 0) return null;

        const inList = sqlInList(list);

        return `SELECT jcd.Partition AS PartitionName, jcd.Name, jcs.SequenceNumber, jd.Name

FROM JobChain jc

JOIN JobDefinition jcd ON jcd.UniqueId = jc.JobDefinition

JOIN JobChainStep jcs ON jcs.JobChain= jc.UniqueId

JOIN JobChainCall jcc ON jcc.JobChainStep = jcs.UniqueId

JOIN JobDefinition jd ON jcc.JobDefinition = jd.UniqueId

WHERE jcd.Name IN (${inList})

  AND jcd.BranchedLLPVersion = -1

  AND jd.BranchedLLPVersion = -1`;
      },
    },

    {
      id: "rmj-uc4-lookup",

      label: "RMJ ⇄ UC4 Name",

      description:
        "Paste a list of names (one per line, or comma separated), then pick a direction. " +
        '"RMJ → UC4" looks up each RMJ JobDefinition\'s UC4ExternalBusinessKey tag value. ' +
        '"UC4 → RMJ" finds RMJ JobDefinition(s) whose tag ends with ", <UC4Name>" ' +
        "(mirrors Jobdefinition_Minh_Test_GetRMJNameByUC4Name).",

      inputLabel: "Names",

      toggle: {
        options: [
          { value: "rmj-to-uc4", label: "RMJ → UC4" },

          { value: "uc4-to-rmj", label: "UC4 → RMJ" },
        ],

        default: "rmj-to-uc4",
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

        if (direction === "uc4-to-rmj") {
          // Build "(ot.Value LIKE '%, name1' OR ot.Value LIKE '%, name2' OR ...)"

          // Mirrors the Java job's likePattern = "%, " + uc4Name check.

          const likeClauses = list

            .map((v) => `ot.Value LIKE '%, ${v.replace(/'/g, "''")}'`)

            .join("\n     OR ");

          return `${baseSelect}\n  AND (${likeClauses})`;
        }

        // default: rmj-to-uc4

        const inList = sqlInList(list);

        return `${baseSelect}\n  AND jd.Name IN (${inList})`;
      },
    },

    {
      id: "find-siblings",

      label: "Find Siblings (Same Tag)",

      description:
        "Paste a list of RMJ JobDefinition names (one per line, or comma separated). " +
        "Returns every OTHER JobDefinition sharing the exact same UC4ExternalBusinessKey " +
        'tag value — mirrors findSiblingsByUc4Name() / the "split" pGetMultiple mode in ' +
        "Jobdefinition_Minh_Test_GetUC4NameByRmjName.",

      inputLabel: "RMJ JobDefinition names",

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

    {
      id: "search-content",

      label: "Search Content",

      description:
        "Paste one or more search terms (one per line, or comma separated). " +
        "Finds every JobDefinition whose parameter default value and/or script " +
        "source code contains any of the terms. Results from both sources share " +
        "one table (MatchSource column tells you which).",

      inputLabel: "Search term(s)",

      checkboxes: {
        options: [
          { value: "parameter", label: "Parameters", default: true },

          { value: "script", label: "Scripts", default: true },
        ],
      },

      buildQuery: function (list, rawInput, direction, checked) {
        if (list.length === 0) return null;

        const wantParam = !!checked && checked.includes("parameter");

        const wantScript = !!checked && checked.includes("script");

        if (!wantParam && !wantScript) return null;

        const parts = [];

        if (wantParam) {
          parts.push(`SELECT 'Parameter'         AS MatchSource,

       jd.Partition         AS PartitionName,

       jd.Name               AS JobDefinitionName,

       jp.Name               AS DetailName,

       jp.DefaultExpression  AS MatchText,

       1                      AS MatchOccurrence

FROM JobDefinitionParameter jp

JOIN JobDefinition jd

     ON jd.UniqueId = jp.JobDefinition

WHERE jd.BranchedLLPVersion = -1

  AND jp.DefaultExpression <> ' '

  AND ${sqlLikeAny("jp.DefaultExpression", list)}`);
        }

        if (wantScript) {
          parts.push(`SELECT 'Script'            AS MatchSource,

       jd.Partition         AS PartitionName,

       jd.Name               AS JobDefinitionName,

       jdt.Name               AS DetailName,

       sl.LineText           AS MatchText,

       COUNT(*)               AS MatchOccurrence

FROM JobDefinition jd, JobDefinitionType jdt, Script s, ScriptSourceLine sl, ScriptSourceLine sl2

WHERE jd.JobDefinitionType = jdt.UniqueId

  AND jd.UniqueId = s.JobDefinition

  AND jdt.Name IN ( 'JDBC', 'BASH', 'CMD', 'RedwoodScript', 'CSH', 'KSH', 'SQLPLUS', 'PERL' )

  AND jd.BranchedLLPVersion = -1

  AND s.UniqueId = sl.Script

  AND jd.LastModificationTime > NOW('set hour 0 subtract 365 days')

  AND ${sqlLikeAny("sl.LineText", list)}

  AND sl2.Script = sl.Script

  AND ${sqlLikeAny("sl2.LineText", list)}

  AND sl2.LineNumber <= sl.LineNumber

GROUP BY jd.UniqueId, jdt.Name, jd.Name, jd.Partition, jd.CreationTime, s.RunAsUser, s.RemoteRunAsUser, sl.LineText, sl.LineNumber`);
        }

        return (
          parts.join("\n\nUNION ALL\n\n") +
          "\nORDER BY JobDefinitionName, MatchSource"
        );
      },
    },

    {
      id: "list-parameters",

      label: "List Parameters",

      description:
        "Paste a list of JobDefinition names (one per line, or comma separated), and " +
        "tick which parameter(s) to include below. Returns one row per matching " +
        "(JobDefinition, Parameter) pair with its value, rendered by default as a " +
        "JobDefinition × Parameter matrix (one row per JobDefinition, one column " +
        "per ticked parameter) - use the button above the results to switch back " +
        "to the flat row list if needed.",

      inputLabel: "JobDefinition names",

      checkboxes: {
        options: LIST_PARAMETERS_NAMES.map((name) => ({
          value: name,

          label: name,

          default: LIST_PARAMETERS_DEFAULT_CHECKED.has(name),
        })),
      },

      buildQuery: function (list, rawInput, direction, checked) {
        if (list.length === 0) return null;

        if (!checked || checked.length === 0) return null;

        const inList = sqlInList(list);

        const paramInList = sqlInList(checked);

        return `SELECT jd.Name AS JobDefinitionName, jp.Name AS ParameterName, jp.DefaultExpression AS Value

FROM JobDefinitionParameter jp

JOIN JobDefinition jd ON jd.UniqueId = jp.JobDefinition

WHERE jd.Name IN (${inList})

  AND jp.Name IN (${paramInList})

  AND jd.BranchedLLPVersion = -1`;
      },
    },
  ];

  /* -----------------------------------------------------------------------

   * 2. UI INJECTION

   * ---------------------------------------------------------------------*/

  function init() {
    const textarea = document.getElementById("queryEdit");

    const form = textarea ? textarea.closest("form") : null;

    if (!textarea || !form) {
      // Page structure not as expected - bail out quietly.

      return;
    }

    const wrapper = document.createElement("div");

    wrapper.id = "rqh-wrapper";

    wrapper.style.marginBottom = "10px";

    wrapper.style.fontFamily = "verdana, sans-serif";

    wrapper.style.fontSize = "12px";

    // --- Tab bar ---

    const tabBar = document.createElement("div");

    tabBar.style.display = "flex";

    tabBar.style.gap = "4px";

    tabBar.style.marginBottom = "6px";

    tabBar.style.flexWrap = "wrap";

    // --- Panel area (description + input + run button), one per tab ---

    const panelArea = document.createElement("div");

    panelArea.style.border = "1px solid #cccccc";

    panelArea.style.padding = "8px";

    panelArea.style.background = "#f7f7f7";

    const tabButtons = {};

    const panels = {};

    TAB_CONFIGS.forEach((cfg) => {
      // Tab button

      const btn = document.createElement("button");

      btn.type = "button";

      btn.textContent = cfg.label;

      btn.style.padding = "6px 12px";

      btn.style.cursor = "pointer";

      btn.style.border = "1px solid #999";

      btn.style.background = "#e0e0e0";

      btn.dataset.tabId = cfg.id;

      btn.addEventListener("click", () => selectTab(cfg.id));

      tabBar.appendChild(btn);

      tabButtons[cfg.id] = btn;

      // Panel

      const panel = document.createElement("div");

      panel.dataset.tabId = cfg.id;

      panel.style.display = "none";

      if (cfg.description) {
        const desc = document.createElement("div");

        desc.textContent = cfg.description;

        desc.style.marginBottom = "6px";

        desc.style.color = "#333";

        panel.appendChild(desc);
      }

      if (cfg.inputLabel) {
        const label = document.createElement("label");

        label.textContent = cfg.inputLabel + ":";

        label.style.display = "block";

        label.style.fontWeight = "bold";

        label.style.marginBottom = "4px";

        panel.appendChild(label);

        const input = document.createElement("textarea");

        input.rows = 5;

        input.style.width = "100%";

        input.style.fontFamily = "monospace";

        input.placeholder = "One value per line, or comma separated";

        panel.appendChild(input);

        panel._input = input;

        // Optional direction toggle (e.g. RMJ -> UC4 / UC4 -> RMJ) rendered

        // as a single sliding pill switch.

        let currentDirection = cfg.toggle ? cfg.toggle.default : null;

        if (cfg.toggle) {
          injectRQHToggleStyles();

          const toggleWrap = document.createElement("div");

          toggleWrap.className = "rqh-toggle";

          toggleWrap.style.setProperty(
            "--rqh-toggle-count",
            cfg.toggle.options.length,
          );

          const slider = document.createElement("div");

          slider.className = "rqh-toggle-slider";

          toggleWrap.appendChild(slider);

          const optionEls = {};

          cfg.toggle.options.forEach((opt) => {
            const optEl = document.createElement("div");

            optEl.className = "rqh-toggle-option";

            optEl.textContent = opt.label;

            optEl.dataset.value = opt.value;

            optEl.addEventListener("click", () => setActive(opt.value));

            toggleWrap.appendChild(optEl);

            optionEls[opt.value] = optEl;
          });

          function setActive(value) {
            currentDirection = value;

            const idx = cfg.toggle.options.findIndex((o) => o.value === value);

            slider.style.transform = `translateX(${idx * 100}%)`;

            Object.keys(optionEls).forEach((v) => {
              optionEls[v].classList.toggle("active", v === value);
            });
          }

          panel.appendChild(toggleWrap);

          panel._getDirection = () => currentDirection;

          panel._setDirection = setActive;

          setActive(currentDirection);
        }

        // Optional checkbox group (e.g. "search in Parameters and/or

        // Scripts", or the full List Parameters name list) rendered as

        // a wrapping grid of inline checkboxes, plus "All / None"

        // quick-select links when there are more than a handful of

        // options. Multiple options may be active at once, unlike the

        // toggle above.

        let currentChecked = cfg.checkboxes
          ? cfg.checkboxes.options.filter((o) => o.default).map((o) => o.value)
          : null;

        if (cfg.checkboxes) {
          injectRQHCheckboxStyles();

          const cbWrap = document.createElement("div");

          cbWrap.className = "rqh-checkbox-group";

          const checkboxEls = {};

          cfg.checkboxes.options.forEach((opt) => {
            const optLabel = document.createElement("label");

            optLabel.className = "rqh-checkbox-option";

            const cb = document.createElement("input");

            cb.type = "checkbox";

            cb.checked = !!opt.default;

            cb.addEventListener("change", () => {
              currentChecked = cfg.checkboxes.options

                .filter((o) => checkboxEls[o.value].checked)

                .map((o) => o.value);
            });

            optLabel.appendChild(cb);

            optLabel.appendChild(document.createTextNode(opt.label));

            cbWrap.appendChild(optLabel);

            checkboxEls[opt.value] = cb;
          });

          panel.appendChild(cbWrap);

          panel._getChecked = () => currentChecked;

          panel._setChecked = (values) => {
            currentChecked = values.slice();

            cfg.checkboxes.options.forEach((o) => {
              checkboxEls[o.value].checked = currentChecked.includes(o.value);
            });
          };

          // "All / None" quick-select links - only worth showing once

          // there are more than a few checkboxes (e.g. List Parameters'

          // full name list) rather than the small 2-option groups.

          if (cfg.checkboxes.options.length > 4) {
            const actions = document.createElement("div");

            actions.className = "rqh-checkbox-actions";

            const allLink = document.createElement("a");

            allLink.textContent = "All";

            allLink.addEventListener("click", () => {
              panel._setChecked(cfg.checkboxes.options.map((o) => o.value));
            });

            const noneLink = document.createElement("a");

            noneLink.textContent = "None";

            noneLink.addEventListener("click", () => {
              panel._setChecked([]);
            });

            actions.appendChild(allLink);

            actions.appendChild(noneLink);

            panel.appendChild(actions);
          }
        }

        // Optional second textarea (e.g. a fixed set of column names

        // for a pivoted/matrix query) rendered below the toggle/checkboxes.

        if (cfg.secondaryInput) {
          const secLabel = document.createElement("label");

          secLabel.textContent = cfg.secondaryInput.label + ":";

          secLabel.style.display = "block";

          secLabel.style.fontWeight = "bold";

          secLabel.style.margin = "8px 0 4px 0";

          panel.appendChild(secLabel);

          const secInput = document.createElement("textarea");

          secInput.rows = 3;

          secInput.style.width = "100%";

          secInput.style.fontFamily = "monospace";

          secInput.placeholder = "One value per line, or comma separated";

          panel.appendChild(secInput);

          panel._secondaryInput = secInput;
        }

        const runBtn = document.createElement("button");

        runBtn.type = "button";

        runBtn.textContent = "Generate & Run";

        runBtn.style.marginTop = "6px";

        runBtn.style.padding = "4px 10px";

        runBtn.style.cursor = "pointer";

        runBtn.addEventListener("click", () => {
          const list = parseList(input.value);

          const direction = panel._getDirection ? panel._getDirection() : null;

          const checked = panel._getChecked ? panel._getChecked() : null;

          const secondaryValue = panel._secondaryInput
            ? panel._secondaryInput.value
            : "";

          const secondaryList = panel._secondaryInput
            ? parseList(secondaryValue)
            : null;

          const sql = cfg.buildQuery(
            list,
            input.value,
            direction,
            checked,
            secondaryList,
          );

          if (!sql) {
            if (checked && checked.length === 0) {
              alert("Please select at least one option from the checkboxes.");
            } else if (panel._secondaryInput && secondaryList.length === 0) {
              alert("Please paste at least one value in both boxes.");
            } else {
              alert("Please paste at least one value first.");
            }

            return;
          }

          textarea.value = sql;

          // Remember which tab + input (+ direction/checked/secondary) were used,

          // since form.submit() triggers a full page reload and wipes script state.

          try {
            sessionStorage.setItem(
              "rqh-active-tab",

              JSON.stringify({
                id: cfg.id,
                inputValue: input.value,
                direction,
                checked,
                secondaryValue,
              }),
            );
          } catch (e) {
            /* sessionStorage unavailable - non-fatal, just won't restore */
          }

          form.submit();
        });

        panel.appendChild(runBtn);
      } else {
        const note = document.createElement("div");

        note.style.color = "#666";

        note.textContent =
          'Edit the query box below directly, then click "Submit Query" as usual.';

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
        panels[tid].style.display = tid === id ? "block" : "none";

        tabButtons[tid].style.background = tid === id ? "#6598CB" : "#e0e0e0";

        tabButtons[tid].style.color = tid === id ? "#fff" : "#000";
      });

      if (collapseCtl) {
        if (id === "free") {
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
      const saved = sessionStorage.getItem("rqh-active-tab");

      if (saved) restored = JSON.parse(saved);
    } catch (e) {
      /* ignore malformed/unavailable storage */
    }

    if (restored && panels[restored.id]) {
      selectTab(restored.id);

      const panel = panels[restored.id];

      if (panel._input && typeof restored.inputValue === "string") {
        panel._input.value = restored.inputValue;
      }

      if (panel._setDirection && restored.direction) {
        panel._setDirection(restored.direction);
      }

      if (panel._setChecked && restored.checked) {
        panel._setChecked(restored.checked);
      }

      if (
        panel._secondaryInput &&
        typeof restored.secondaryValue === "string"
      ) {
        panel._secondaryInput.value = restored.secondaryValue;
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

    scanAndReorderRows();

    scanAndEnhanceReportTables();

    compactQueryMeta();

    scanAndParseUc4Names();

    scanAndAddGraphViews();

    scanAndAddParameterMatrix();

    scanAndMakeResizable();

    scanAndAddCsvLinks();

    scanAndAddResultFilters();

    new MutationObserver(() => {
      scanAndReorderRows();

      scanAndEnhanceReportTables();

      compactQueryMeta();

      scanAndParseUc4Names();

      scanAndAddGraphViews();

      scanAndAddParameterMatrix();

      scanAndMakeResizable();

      scanAndAddCsvLinks();

      scanAndAddResultFilters();
    }).observe(document.body, {
      childList: true,

      subtree: true,
    });
  }
})();
