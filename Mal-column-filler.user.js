// ==UserScript==
// @name         MALCF: MAL Column Filler
// @namespace    bosch-asportal
// @version      1.1
// @description  Injects paste/fill buttons into APEX grid headers for Comment, Status, and CID columns
// @author       You
// @match        *://*/rb-aeinfoapp/ords/f?p=100:44:*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const TOOLBAR_ID = "acf-toolbar";
  const MODAL_ID = "acf-modal";
  const STATUS_MODAL_ID = "acf-status-modal";
  const POLL_MS = 1500;

  const STATUS_OPTIONS = [
    "DELETE_OBJECT",
    "DONE",
    "FAIL",
    "GOOD",
    "IN_PROGRESS",
    "OPEN",
    "SKIP",
    "TODO",
  ];

  function log(...a) {
    console.log("[ACF]", ...a);
  }

  /* ───────────────────────── PARSING ───────────────────────── */

  // One entry per line. Empty lines count as SKIP (preserved for row alignment).
  // Exception: if the user wraps entries in "double quotes", each quoted block
  // is one entry (allows multi-line comments). Unquoted lines outside blocks
  // are still included as single-line entries.
  function parseEntries(raw) {
    raw = raw.replace(/\r\n/g, "\n");

    // Quoted-block mode: only engage if the input actually contains a standalone
    // opening quote at the start of a line (i.e. the user deliberately quoted).
    if (/^"/m.test(raw) && raw.includes('"')) {
      const entries = [];
      let i = 0;
      while (i < raw.length) {
        // Skip leading whitespace/newlines between blocks
        const nlMatch = raw.slice(i).match(/^\s+/);
        if (nlMatch) { i += nlMatch[0].length; continue; }

        if (raw[i] === '"') {
          // Find closing quote
          const close = raw.indexOf('"', i + 1);
          if (close === -1) {
            // Unclosed quote — treat rest as plain text
            entries.push(...raw.slice(i + 1).split("\n").map((s) => s.trim()).filter(Boolean));
            break;
          }
          const block = raw.slice(i + 1, close).trim();
          entries.push(block); // push even if empty (becomes blank/SKIP)
          i = close + 1;
        } else {
          // Unquoted: consume until next newline
          const end = raw.indexOf("\n", i);
          const line = (end === -1 ? raw.slice(i) : raw.slice(i, end)).trim();
          if (line) entries.push(line);
          i = end === -1 ? raw.length : end + 1;
        }
      }
      if (entries.length) return entries;
    }

    // Plain mode: one entry per line, preserving empty lines as "" (SKIP placeholders)
    const lines = raw.split("\n");
    // Strip at most one trailing empty line — Excel/clipboard always appends a
    // final newline, but any further trailing blanks are real rows to SKIP.
    if (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    return lines.map((s) => s.trim());
  }

  function normaliseEntry(entry) {
    return entry.replace(/\r\n/g, "\n").trim();
  }

  /* ───────────────────────── DOM HELPERS ───────────────────── */

    function findColIndex(colName) {
        // Find the th in the header and get its data-idx
        const headerTable = document.querySelector(".a-GV-w-hdr table");
        if (!headerTable) return -1;
        let dataIdx = null;
        for (const th of headerTable.querySelectorAll("th[data-idx]")) {
            const lbl = th.querySelector(".a-GV-headerLabel");
            if (lbl && lbl.textContent.trim().toLowerCase() === colName.toLowerCase()) {
                dataIdx = th.getAttribute("data-idx");
                break;
            }
        }
        if (dataIdx === null) return -1;

        // Now find the sequential position of that data-idx in the scroll body's colgroup
        const scrollTable = document.querySelector(".a-GV-w-scroll table");
        if (!scrollTable) return -1;
        const cols = scrollTable.querySelectorAll("colgroup col[data-idx]");
        for (let i = 0; i < cols.length; i++) {
            if (cols[i].getAttribute("data-idx") === dataIdx) return i;
        }
        return -1;
    }

  function findCellsByCol(colName) {
    const idx = findColIndex(colName);
    if (idx < 0) return [];
    const dataTbody = document.querySelector(".a-GV-w-scroll tbody");
    if (!dataTbody) return [];
    return Array.from(dataTbody.querySelectorAll("tr.a-GV-row"))
      .map((row) => row.querySelectorAll("td.a-GV-cell")[idx] || null)
      .filter(Boolean);
  }

  function findCommentCells() { return findCellsByCol("comment"); }
  function findStatusCells()  { return findCellsByCol("status"); }

  function findHeaderTh(colName) {
    for (const th of document.querySelectorAll("th.a-GV-header")) {
      const label = th.querySelector(".a-GV-headerLabel");
      if (label && label.textContent.trim().toLowerCase() === colName.toLowerCase()) return th;
    }
    return null;
  }

  function findCommentHeader() { return findHeaderTh("comment"); }
  function findStatusHeader()  { return findHeaderTh("status"); }
  function findCidHeader()     { return findHeaderTh("cid"); }

  function getCellForRow(row, colName) {
    const idx = findColIndex(colName);
    if (idx < 0) return null;
    const rownum = row.getAttribute("data-rownum");
    const scrollRow = document.querySelector(`.a-GV-w-scroll tbody tr.a-GV-row[data-rownum="${rownum}"]`);
    if (!scrollRow) return null;
    return scrollRow.querySelectorAll("td.a-GV-cell")[idx] || null;
  }

  function buildCidRowMap() {
    const map = {};
    document.querySelectorAll("tr.a-GV-row[data-id]").forEach((row) => {
      map[row.getAttribute("data-id").toUpperCase()] = row;
    });
    return map;
  }

  /* ─────────────────── FIELD DETECTION ────────────────────── */

  async function primeAndFindTextarea(firstCell) {
    firstCell.click();
    await new Promise((r) => setTimeout(r, 350));
    const active = document.activeElement;
    if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT") && active.offsetParent !== null) {
      log("Found via activeElement"); return active;
    }
    for (const label of document.querySelectorAll("label")) {
      if (/^comment$/i.test(label.textContent.trim())) {
        const forId = label.getAttribute("for");
        if (forId) {
          const el = document.getElementById(forId);
          if (el && el.offsetParent !== null) { log("Found via label[for]"); return el; }
        }
        const inp = label.querySelector("textarea, input:not([type=hidden])");
        if (inp && inp.offsetParent !== null) { log("Found via label child"); return inp; }
        const sib = label.nextElementSibling;
        if (sib && (sib.tagName === "TEXTAREA" || sib.tagName === "INPUT") && sib.offsetParent !== null) {
          log("Found via label sibling"); return sib;
        }
      }
    }
    for (const container of document.querySelectorAll('.t-Form-fieldContainer, .apex-item-group, .col, [class*="field"]')) {
      const lbl = container.querySelector("label, .t-Form-label, span.t-Form-label");
      if (lbl && /^comment$/i.test(lbl.textContent.trim())) {
        const ta = container.querySelector("textarea");
        if (ta && ta.offsetParent !== null) { log("Found via container label"); return ta; }
      }
    }
    const allTa = Array.from(document.querySelectorAll("textarea")).filter((ta) => ta.offsetParent !== null);
    log("Visible textareas:", allTa.length, allTa.map((t) => t.id || t.className));
    if (allTa.length === 1) return allTa[0];
    return null;
  }

  function findStatusSelect() {
    for (const sel of document.querySelectorAll("select")) {
      const opts = Array.from(sel.options).map((o) => o.value);
      if (opts.includes("TODO") && opts.includes("DONE") && opts.includes("OPEN")) {
        log("Found status select:", sel.id); return sel;
      }
    }
    return null;
  }

  function isEditMode() {
    return !!document.querySelector(".a-GV--editMode");
  }

  /* ───────────────────────── NATIVE VALUE ─────────────────── */

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setNativeSelect(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
    if (nativeSetter && nativeSetter.set) nativeSetter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /* ───────────────────────── FILL LOGIC ───────────────────── */

  async function fillCells(entries, cells, commentTextarea, statusEl) {
    const count = Math.min(entries.length, cells.length);
    statusEl.textContent = `Filling 0 / ${count}…`;
    for (let i = 0; i < count; i++) {
      const value = entries[i];
      if (value === "" || /^SKIP$/i.test(value)) {
        statusEl.textContent = `Skipping row ${i + 1}`;
        continue;
      }
      cells[i].click();
      await new Promise((r) => setTimeout(r, 100));
      setNativeValue(commentTextarea, value);
      commentTextarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", keyCode: 9, which: 9, bubbles: true, cancelable: true }));
      commentTextarea.blur();
      await new Promise((r) => setTimeout(r, 50));
      statusEl.textContent = `Filled ${i + 1} / ${count}`;
    }
  }

  async function fillStatusCells(statusValue, cells, statusEl) {
    statusEl.textContent = "Detecting Status field…";
    if (!isEditMode()) {
      statusEl.textContent = "⚠ Could not detect Status field. Please make sure you are in 'Edit' mode";
      return false;
    }
    const statusSelect = findStatusSelect();
    if (!statusSelect) {
      statusEl.textContent = "⚠ Could not detect Status field. Please make sure you are in 'Edit' mode";
      return false;
    }
    const count = cells.length;
    statusEl.textContent = `Filling all ${count} rows…`;
    for (let i = 0; i < count; i++) {
      cells[i].click();
      await new Promise((r) => setTimeout(r, 100));
      setNativeSelect(statusSelect, statusValue);
      statusSelect.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", keyCode: 9, which: 9, bubbles: true, cancelable: true }));
      statusSelect.blur();
      await new Promise((r) => setTimeout(r, 50));
    }
    statusEl.textContent = `✓ Done — all ${count} rows set to "${statusValue}"`;
    return true;
  }

  /* ───────────────────────── UTILS ────────────────────────── */

  function escHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ───────────────────────── COMMENT MODAL ────────────────── */

  function buildModal() {
    if (document.getElementById(MODAL_ID)) return;
    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      background:rgba(0,0,0,.45);
      display:flex;align-items:center;justify-content:center;
    `;
    overlay.innerHTML = `
      <div id="acf-dialog" style="
        background:#fff;border-radius:10px;padding:24px;
        width:680px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,.25);
        font-family:sans-serif;font-size:14px;color:#222;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <strong style="font-size:16px;">Paste Comment values</strong>
          <button id="acf-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666;line-height:1;padding:0 4px;">✕</button>
        </div>
        <p style="margin:0 0 10px;color:#555;line-height:1.5;">
          Paste entries below — <strong>one per line</strong>, matching grid row order.<br>
          Leave a line blank (or type <code>SKIP</code>) to skip that row.<br>
          For multi-line comments, wrap each entry in <code>"double quotes"</code>.
        </p>
        <textarea id="acf-input" rows="10" style="
          width:100%;box-sizing:border-box;border:1px solid #ccc;
          border-radius:6px;padding:10px;font-size:13px;font-family:monospace;
          resize:vertical;outline:none;
        " placeholder="Paste entries here…"></textarea>
        <div style="margin-top:10px;display:flex;gap:10px;align-items:center;">
          <button id="acf-preview" style="padding:7px 16px;border-radius:6px;border:1px solid #aaa;background:#f5f5f5;cursor:pointer;font-size:13px;">Preview parse</button>
          <button id="acf-fill" style="padding:7px 18px;border-radius:6px;border:none;background:#1a73e8;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Fill column ▶</button>
          <span id="acf-status" style="color:#555;flex:1;text-align:right;"></span>
        </div>
        <div id="acf-preview-box" style="
          margin-top:12px;display:none;border:1px solid #e0e0e0;border-radius:6px;
          padding:10px;background:#fafafa;max-height:200px;overflow-y:auto;
        "></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const dialog    = overlay.querySelector("#acf-dialog");
    const statusEl  = overlay.querySelector("#acf-status");
    const previewBox= overlay.querySelector("#acf-preview-box");
    const textarea  = overlay.querySelector("#acf-input");

    const STOP = (e) => e.stopPropagation();
    ["keydown","keyup","keypress","paste","input"].forEach((ev) => {
      dialog.addEventListener(ev, STOP, true);
      overlay.addEventListener(ev, STOP, true);
    });

    overlay.querySelector("#acf-close").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector("#acf-preview").addEventListener("click", (e) => {
      e.stopPropagation();
      const entries = parseEntries(textarea.value);
      previewBox.style.display = "block";
      if (!entries.length) { previewBox.innerHTML = '<em style="color:#999">No entries detected.</em>'; return; }
      previewBox.innerHTML = entries.map((entry, i) => `
        <div style="margin-bottom:8px;padding:6px 8px;background:#fff;border:1px solid #e0e0e0;border-radius:4px;">
          <span style="font-size:11px;color:#999;display:block;margin-bottom:3px;">Entry ${i + 1}</span>
          <pre style="margin:0;font-size:12px;white-space:pre-wrap;word-break:break-all;">${escHtml(entry)}</pre>
        </div>`).join("");
      statusEl.textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"} detected`;
    });

    overlay.querySelector("#acf-fill").addEventListener("click", async (e) => {
      e.stopPropagation();
      const entries = parseEntries(textarea.value).map(normaliseEntry);
      if (!entries.length) { statusEl.textContent = "No entries to fill."; return; }
      const cells = findCommentCells();
      if (!cells.length) { statusEl.textContent = "⚠ Could not find Comment cells."; return; }
      statusEl.textContent = "Detecting Comment field…";
      const commentTextarea = await primeAndFindTextarea(cells[0]);
      if (!commentTextarea) {
        statusEl.textContent = "⚠ Could not detect Comment field. Please make sure you are in 'Edit' mode";
        return;
      }
      log("Using textarea:", commentTextarea.id, commentTextarea.className);
      overlay.querySelector("#acf-fill").disabled = true;
      overlay.querySelector("#acf-preview").disabled = true;
      await fillCells(entries, cells, commentTextarea, statusEl);
      overlay.querySelector("#acf-fill").disabled = false;
      overlay.querySelector("#acf-preview").disabled = false;
    });
  }

  /* ───────────────────────── STATUS MODAL ─────────────────── */

  function buildStatusModal() {
    if (document.getElementById(STATUS_MODAL_ID)) return;
    const overlay = document.createElement("div");
    overlay.id = STATUS_MODAL_ID;
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      background:rgba(0,0,0,.45);
      display:flex;align-items:center;justify-content:center;
    `;
    const optionColors = {
      DONE:          { bg:"#e6f4ea", border:"#34a853", text:"#1e7e34" },
      GOOD:          { bg:"#e6f4ea", border:"#34a853", text:"#1e7e34" },
      TODO:          { bg:"#e8f0fe", border:"#4285f4", text:"#1a56c4" },
      OPEN:          { bg:"#e8f0fe", border:"#4285f4", text:"#1a56c4" },
      IN_PROGRESS:   { bg:"#fef9e7", border:"#f9ab00", text:"#b06000" },
      FAIL:          { bg:"#fce8e6", border:"#ea4335", text:"#c5221f" },
      SKIP:          { bg:"#f1f3f4", border:"#9aa0a6", text:"#555"    },
      DELETE_OBJECT: { bg:"#fce8e6", border:"#ea4335", text:"#c5221f" },
    };
    const optionsHtml = STATUS_OPTIONS.map((opt) => {
      const c = optionColors[opt] || { bg:"#f5f5f5", border:"#aaa", text:"#333" };
      return `<button class="acf-status-opt" data-value="${opt}" style="
        padding:8px 16px;border-radius:20px;cursor:pointer;font-size:13px;
        font-weight:600;border:2px solid ${c.border};
        background:${c.bg};color:${c.text};transition:opacity .15s;">${opt}</button>`;
    }).join("");
    overlay.innerHTML = `
      <div id="acf-status-dialog" style="
        background:#fff;border-radius:10px;padding:24px;
        width:480px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,.25);
        font-family:sans-serif;font-size:14px;color:#222;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <strong style="font-size:16px;">🔄 Fill all rows — Status</strong>
          <button id="acf-status-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666;line-height:1;padding:0 4px;">✕</button>
        </div>
        <p style="margin:0 0 16px;color:#555;line-height:1.5;">
          Choose a status value to apply to <strong>all visible rows</strong> on this page.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px;">${optionsHtml}</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span id="acf-status-msg" style="color:#555;font-size:13px;flex:1;"></span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const dialog = overlay.querySelector("#acf-status-dialog");
    const msgEl  = overlay.querySelector("#acf-status-msg");
    const STOP   = (e) => e.stopPropagation();
    ["keydown","keyup","keypress"].forEach((ev) => {
      dialog.addEventListener(ev, STOP, true);
      overlay.addEventListener(ev, STOP, true);
    });
    overlay.querySelector("#acf-status-close").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll(".acf-status-opt").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const value = btn.getAttribute("data-value");
        const cells = findStatusCells();
        if (!cells.length) {
          msgEl.style.color = "#c5221f";
          msgEl.textContent = "⚠ Could not find Status cells. Make sure you are in Edit mode.";
          return;
        }
        overlay.querySelectorAll(".acf-status-opt").forEach((b) => { b.disabled = true; b.style.opacity = "0.5"; });
        msgEl.style.color = "#555";
        msgEl.textContent = `Filling all rows with "${value}"…`;
        const ok = await fillStatusCells(value, cells, msgEl);
        if (ok) msgEl.style.color = "#1e7e34";
        overlay.querySelectorAll(".acf-status-opt").forEach((b) => { b.disabled = false; b.style.opacity = "1"; });
      });
    });
  }

  /* ───────────────────────── CID MODAL ────────────────────── */

  function buildCidModal() {
    const CID_MODAL_ID = "acf-cid-modal";
    if (document.getElementById(CID_MODAL_ID)) return;
    const overlay = document.createElement("div");
    overlay.id = CID_MODAL_ID;
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      background:rgba(0,0,0,.45);
      display:flex;align-items:center;justify-content:center;
    `;

    const mkField = (id, labelTxt, placeholder) => `
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <label style="font-size:12px;font-weight:600;color:#444;">${labelTxt}</label>
        </div>
        <textarea id="${id}" rows="12" style="
          width:100%;box-sizing:border-box;border:1px solid #ccc;
          border-radius:6px;padding:8px;font-size:12px;font-family:monospace;
          resize:vertical;outline:none;
        " placeholder="${placeholder}"></textarea>
      </div>`;

    overlay.innerHTML = `
      <div id="acf-cid-dialog" style="
        background:#fff;border-radius:10px;padding:24px;
        width:900px;max-width:97vw;box-shadow:0 8px 32px rgba(0,0,0,.25);
        font-family:sans-serif;font-size:14px;color:#222;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <strong style="font-size:16px;">📎 Fill by CID</strong>
          <button id="acf-cid-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666;line-height:1;padding:0 4px;">✕</button>
        </div>
        <p style="margin:0 0 12px;color:#555;font-size:13px;line-height:1.5;">
          Paste Excel data (with tabs) into the <strong>leftmost column of your selection</strong> — it fills rightward from there.<br>
          Paste into <strong>Status</strong> with 2 columns and hex CIDs? It auto-skips Comment and maps to Status + CID.<br>
          Or paste each column separately. Rows matched by CID; order doesn't matter.
        </p>
        <div style="display:grid;grid-template-columns:120px 1fr 210px;gap:10px;margin-bottom:8px;">
          ${mkField("acf-cid-status-input", "Status", "DONE\nTODO\nSKIP\n…")}
          ${mkField("acf-cid-comment",      "Comment", "Paste here — or paste all columns at once with tabs")}
          ${mkField("acf-cid-ids",          "CID",     "4F16F77CC69BB579…\n4F16F77CC69CB579…")}
        </div>
        <div style="margin-bottom:12px;">
          <button id="acf-cid-clear-all" style="
            padding:5px 14px;border-radius:6px;border:1px solid #ddd;
            background:#f5f5f5;cursor:pointer;font-size:12px;color:#555;font-weight:600;
          ">🗑 Clear all fields</button>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button id="acf-cid-preview" style="padding:7px 16px;border-radius:6px;border:1px solid #aaa;background:#f5f5f5;cursor:pointer;font-size:13px;">Preview</button>
          <button id="acf-cid-fill" style="padding:7px 18px;border-radius:6px;border:none;background:#1a73e8;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Fill by CID ▶</button>
          <span id="acf-cid-status" style="color:#555;flex:1;text-align:right;font-size:13px;"></span>
        </div>
        <div id="acf-cid-preview-box" style="
          margin-top:12px;display:none;border:1px solid #e0e0e0;border-radius:6px;
          padding:10px;background:#fafafa;max-height:220px;overflow-y:auto;
        "></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const dialog    = overlay.querySelector("#acf-cid-dialog");
    const statusEl  = overlay.querySelector("#acf-cid-status");
    const previewBox= overlay.querySelector("#acf-cid-preview-box");
    const statusTA  = overlay.querySelector("#acf-cid-status-input");
    const commentTA = overlay.querySelector("#acf-cid-comment");
    const cidTA     = overlay.querySelector("#acf-cid-ids");

    const STOP = (e) => e.stopPropagation();
    ["keydown","keyup","keypress"].forEach((ev) => {
      dialog.addEventListener(ev, STOP, true);
      overlay.addEventListener(ev, STOP, true);
    });
    overlay.querySelector("#acf-cid-close").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    // ── Internal grid state ──────────────────────────────────────
    // Each element: { status: string, comment: string, cid: string }
    // This is the single source of truth. Textareas are display-only mirrors.
    let grid = []; // array of row objects

    function clearAll() {
      grid = [];
      statusTA.value = "";
      commentTA.value = "";
      cidTA.value = "";
      statusEl.textContent = "";
      previewBox.style.display = "none";
      previewBox.innerHTML = "";
    }

    // Clear all fields button
    overlay.querySelector("#acf-cid-clear-all").addEventListener("click", (e) => {
      e.stopPropagation();
      clearAll();
      statusTA.focus();
    });

    // ── Paste handler ─────────────────────────────────────────────
    // TARGETS order matches visual columns: Status=0, Comment=1, CID=2
    const TARGETS = [statusTA, commentTA, cidTA];
    const COL_NAMES = ["Status", "Comment", "CID"];

    function parseRawPaste(raw) {
      // Excel wraps cells containing newlines in double-quotes (RFC 4180-style).
      // We must parse tab-delimited data respecting quoted multi-line cells,
      // rather than naively splitting on \n.
      const rows = [];
      let i = 0;
      raw = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      while (i < raw.length) {
        const row = [];
        // Parse one row (terminated by \n outside a quoted cell, or EOF)
        while (i < raw.length && raw[i] !== "\n") {
          if (raw[i] === '"') {
            // Quoted cell: consume until closing quote (double-quote = escaped quote)
            i++; // skip opening quote
            let cell = "";
            while (i < raw.length) {
              if (raw[i] === '"') {
                if (raw[i + 1] === '"') {
                  cell += '"';
                  i += 2;
                } // escaped quote
                else {
                  i++;
                  break;
                } // closing quote
              } else {
                cell += raw[i++];
              }
            }
            row.push(cell.trim());
          } else {
            // Unquoted cell: consume until tab or newline
            let cell = "";
            while (i < raw.length && raw[i] !== "\t" && raw[i] !== "\n") {
              cell += raw[i++];
            }
            row.push(cell.trim());
          }
          // Consume the tab separator between cells
          if (i < raw.length && raw[i] === "\t") i++;
        }
        // Consume the row-terminating newline
        if (i < raw.length && raw[i] === "\n") i++;
        if (row.length) rows.push(row);
      }

      // Drop trailing completely-blank rows (Excel always appends a trailing \n)
      while (rows.length && rows[rows.length - 1].every((c) => c === ""))
        rows.pop();
      return rows;
    }
    function looksLikeCid(v) {
      return /^[0-9A-Fa-f]{16,}$/.test(v);
    }

    function resolveColMapping(startIdx, rows) {
      const numPastedCols = Math.max(...rows.map((r) => r.length));
      // Special case: 2 cols pasted into Status and right col looks like CIDs → Status + CID
      if (startIdx === 0 && numPastedCols === 2) {
        const sample = rows.slice(0, Math.min(rows.length, 5)).map((r) => r[1] || "");
        const cidHits = sample.filter(looksLikeCid).length;
        if (cidHits >= Math.min(sample.length, 2)) {
          return [0, 2]; // Status, CID (skip Comment)
        }
      }
      // General: fill consecutive slots from startIdx
      return Array.from({ length: numPastedCols }, (_, ci) => startIdx + ci)
        .filter((idx) => idx < TARGETS.length);
    }

    function rebuildGrid(colMapping, rows) {
      // Merge new columns into the grid, preserving existing columns not in colMapping
      const n = rows.length;
      // Grow grid if needed
      while (grid.length < n) grid.push({ status: "", comment: "", cid: "" });
      // Overwrite only the affected columns
      const keys = ["status", "comment", "cid"];
      rows.forEach((cells, ri) => {
        colMapping.forEach((targetIdx, ci) => {
          grid[ri][keys[targetIdx]] = cells[ci] || "";
        });
      });
      // Truncate grid to match new paste length
      if (n < grid.length) {
        grid = grid.slice(0, n);
      }
    }

    function mirrorToTextareas() {
      statusTA.value  = grid.map((r) => r.status).join("\n");
      commentTA.value = grid.map((r) => r.comment).join("\n");
      cidTA.value     = grid.map((r) => r.cid).join("\n");
    }

    function handlePaste(targetTA, e) {
      const raw = (e.clipboardData || window.clipboardData).getData("text");
      if (!raw.includes("\t")) return; // no tabs → plain text, let browser handle
      e.preventDefault();

      const rows = parseRawPaste(raw);
      if (!rows.length) return;

      const startIdx = TARGETS.indexOf(targetTA);
      const colMapping = resolveColMapping(startIdx, rows);

      rebuildGrid(colMapping, rows);
      mirrorToTextareas();

      const names = colMapping.map((i) => COL_NAMES[i]).join(" + ");
      statusEl.textContent = `✓ Pasted ${rows.length} rows into: ${names}`;
    }

    TARGETS.forEach((ta) => {
      ta.addEventListener("paste", (e) => { e.stopPropagation(); handlePaste(ta, e); });
    });

    // ── Parse / validate from grid state ─────────────────────────
    function parseInputs() {
      // Also accept manual edits in the textareas by re-syncing grid from them
      // (only if grid is empty — i.e. user typed manually without pasting tabs)
      if (!grid.length) {
        const splitTA = (raw) => {
          if (!raw.trim()) return [];
          const lines = raw.split("\n").map((s) => s.trim());
          let i = lines.length;
          while (i > 0 && lines[i - 1] === "") i--;
          return lines.slice(0, i);
        };
        const ss = splitTA(statusTA.value);
        const cs = splitTA(commentTA.value);
        const ids = splitTA(cidTA.value).map((s) => s.toUpperCase()).filter(Boolean);
        const n = Math.max(ss.length, cs.length, ids.length);
        for (let i = 0; i < n; i++) {
          grid.push({ status: ss[i] || "", comment: cs[i] || "", cid: ids[i] || "" });
        }
      }
      const statuses = grid.map((r) => r.status);
      const comments = grid.map((r) => r.comment);
      const cids     = grid.map((r) => r.cid.toUpperCase()).filter(Boolean);
      return { statuses, comments, cids };
    }

    function validateInputs({ statuses, comments, cids }, forEl) {
      if (!cids.length) {
        forEl.textContent = "⚠ CID column is required."; return false;
      }
      const hasSomeComment = comments.some((c) => c !== "");
      const hasSomeStatus  = statuses.some((s) => s !== "");
      if (!hasSomeComment && !hasSomeStatus) {
        forEl.textContent = "⚠ Paste at least Comment or Status column."; return false;
      }
      const invalid = statuses
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s !== "" && !STATUS_OPTIONS.includes(s));
      if (invalid.length) {
        const examples = invalid.slice(0, 3).map(({ s, i }) => `row ${i + 1}: "${s}"`).join(", ");
        forEl.textContent = `⚠ Invalid status value(s): ${examples}. Allowed: ${STATUS_OPTIONS.join(", ")}`;
        return false;
      }
      return true;
    }

    overlay.querySelector("#acf-cid-preview").addEventListener("click", (e) => {
      e.stopPropagation();
      const inputs = parseInputs();
      previewBox.style.display = "block";
      const errEl = { textContent: "" };
      if (!validateInputs(inputs, errEl)) {
        previewBox.innerHTML = `<em style="color:#c5221f">${escHtml(errEl.textContent)}</em>`;
        statusEl.textContent = errEl.textContent;
        return;
      }
      const cidMap = buildCidRowMap();
      const rows = grid.filter((r) => r.cid);
      const hasAnyComment = rows.some((r) => r.comment);
      const colTemplate = hasAnyComment ? "110px 1fr 200px" : "110px 200px";
      previewBox.innerHTML = rows.map((r) => {
        const cid     = r.cid.toUpperCase();
        const found   = !!cidMap[cid];
        const comment = r.comment || "";
        const status  = r.status  || "";
        const statusInvalid = status && !STATUS_OPTIONS.includes(status);
        const commentCol = hasAnyComment ? `<div>
              <span style="font-size:10px;color:#999;display:block;margin-bottom:2px;">Comment</span>
              <pre style="margin:0;font-size:11px;white-space:pre-wrap;word-break:break-all;">${escHtml(comment || "—")}</pre>
            </div>` : "";
        return `<div style="margin-bottom:6px;padding:6px 8px;background:#fff;border:1px solid #e0e0e0;border-radius:4px;display:grid;grid-template-columns:${colTemplate};gap:8px;align-items:start;">
            <div>
              <span style="font-size:10px;color:#999;display:block;margin-bottom:2px;">Status</span>
              <code style="font-size:11px;display:block;color:${statusInvalid ? "#c5221f" : "inherit"};">${escHtml(status || "—")}${statusInvalid ? " ⚠" : ""}</code>
            </div>
            ${commentCol}
            <div style="text-align:right;">
              <span style="font-size:10px;color:#999;display:block;margin-bottom:2px;">CID</span>
              <code style="font-size:10px;">${escHtml(cid)}</code><br>
              <span style="font-size:11px;color:${found ? "#1e7e34" : "#c5221f"};">${found ? "✓ on page" : "⚠ not found"}</span>
            </div>
          </div>`;
      }).join("");
      const onPage = rows.filter((r) => cidMap[r.cid.toUpperCase()]).length;
      statusEl.textContent = `${rows.length} entries — ${onPage} matched on this page`;
    });

    overlay.querySelector("#acf-cid-fill").addEventListener("click", async (e) => {
      e.stopPropagation();
      const inputs = parseInputs();
      if (!validateInputs(inputs, statusEl)) return;
      if (!isEditMode()) {
        statusEl.textContent = "⚠ Please make sure you are in 'Edit' mode"; return;
      }
      const cidMap = buildCidRowMap();
      // Build work list directly from grid rows — index alignment is guaranteed
      const workList = grid
        .filter((r) => r.cid)
        .map((r) => ({ ...r, cid: r.cid.toUpperCase(), row: cidMap[r.cid.toUpperCase()] }))
        .filter((item) => item.row);
      if (!workList.length) { statusEl.textContent = "⚠ No CIDs matched rows on this page."; return; }

      const resolved = workList.map((item) => ({
        ...item,
        commentCell: getCellForRow(item.row, "comment"),
        statusCell:  getCellForRow(item.row, "status"),
      }));

      let commentTextarea = null;
      if (resolved.some((r) => r.comment)) {
        const first = resolved.find((r) => r.comment && r.commentCell);
        if (first) {
          statusEl.textContent = "Detecting Comment field…";
          commentTextarea = await primeAndFindTextarea(first.commentCell);
          if (!commentTextarea) {
            statusEl.textContent = "⚠ Could not detect Comment field. Please make sure you are in 'Edit' mode";
            return;
          }
        }
      }
      const statusSelect = findStatusSelect();

      overlay.querySelector("#acf-cid-fill").disabled = true;
      overlay.querySelector("#acf-cid-preview").disabled = true;

      const count = resolved.length;
      for (let i = 0; i < count; i++) {
        const { comment, status, commentCell, statusCell } = resolved[i];
        if (comment && commentCell && commentTextarea) {
          commentCell.click();
          await new Promise((r) => setTimeout(r, 100));
          setNativeValue(commentTextarea, normaliseEntry(comment));
          commentTextarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", keyCode: 9, which: 9, bubbles: true, cancelable: true }));
          commentTextarea.blur();
          await new Promise((r) => setTimeout(r, 50));
        }
        if (status && statusSelect && statusCell) {
          statusCell.click();
          await new Promise((r) => setTimeout(r, 100));
          setNativeSelect(statusSelect, status);
          statusSelect.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", keyCode: 9, which: 9, bubbles: true, cancelable: true }));
          statusSelect.blur();
          await new Promise((r) => setTimeout(r, 50));
        }
        statusEl.textContent = `Filled ${i + 1} / ${count}`;
      }

      const total = grid.filter((r) => r.cid).length;
      const skipped = total - workList.length;
      statusEl.textContent = `✓ Done — ${count} filled${skipped ? `, ${skipped} CID(s) not on this page` : ""}`;
      overlay.querySelector("#acf-cid-fill").disabled = false;
      overlay.querySelector("#acf-cid-preview").disabled = false;
    });
  }

  /* ───────────────────────── HEADER BUTTON INJECTION ───────── */

  function makeHeaderBtn(id, label, onClick) {
    const btn = document.createElement("button");
    btn.id = id;
    btn.textContent = label;
    btn.style.cssText = `
      display:block;width:100%;margin-top:4px;padding:2px 6px;
      background:#1a73e8;color:#fff;border:none;
      border-radius:4px;font-size:10px;font-weight:600;
      cursor:pointer;white-space:nowrap;z-index:9999;
      box-shadow:0 1px 3px rgba(0,0,0,.2);line-height:1.6;
    `;
    btn.addEventListener("mouseenter", () => (btn.style.background = "#1558b0"));
    btn.addEventListener("mouseleave", () => (btn.style.background = "#1a73e8"));
    btn.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); onClick(); });
    return btn;
  }

  function injectButtons() {
    const commentTh = findCommentHeader();
    const statusTh  = findStatusHeader();
    const cidTh     = findCidHeader();
    if (!commentTh && !statusTh && !cidTh) return;
    if (commentTh && !document.getElementById(TOOLBAR_ID)) {
      const btn = makeHeaderBtn(TOOLBAR_ID, "📋 Paste", buildModal);
      commentTh.style.verticalAlign = "top";
      commentTh.appendChild(btn);
      log("Comment button injected.");
    }
    if (statusTh && !document.getElementById("acf-status-toolbar")) {
      const btn = makeHeaderBtn("acf-status-toolbar", "🔄 Fill", buildStatusModal);
      statusTh.style.verticalAlign = "top";
      statusTh.appendChild(btn);
      log("Status button injected.");
    }
    if (cidTh && !document.getElementById("acf-cid-toolbar")) {
      const btn = makeHeaderBtn("acf-cid-toolbar", "📎 Fill by CID", buildCidModal);
      cidTh.style.verticalAlign = "top";
      cidTh.appendChild(btn);
      log("CID button injected.");
    }
  }

  function tryInject() { injectButtons(); }

  tryInject();
  const interval = setInterval(() => {
    if (
      document.getElementById(TOOLBAR_ID) &&
      document.getElementById("acf-status-toolbar") &&
      document.getElementById("acf-cid-toolbar")
    ) { clearInterval(interval); return; }
    tryInject();
  }, POLL_MS);
})();
