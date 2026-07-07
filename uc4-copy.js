// ==UserScript==
// @name         UC4 copy
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Adds a Copy button to each column header in Vaadin tables, copying all cell values in that column to clipboard line by line
// @author       You
// @match        *://*/awi/EUP6/*
// @match        *://*/awi/EUP7/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const btnStyle = `
    margin-left: 6px;
    padding: 2px 7px;
    font-size: 11px;
    cursor: pointer;
    border: 1px solid #aaa;
    border-radius: 3px;
    background: #f5f5f5;
    color: #333;
    vertical-align: middle;
    user-select: none;
  `;

  function showSuccess(btn) {
    btn.textContent = "Copied!";
    btn.style.background = "#d4edda";
    btn.style.borderColor = "#28a745";
    btn.style.color = "#155724";
    setTimeout(() => {
      btn.textContent = "Copy";
      btn.style.background = "#f5f5f5";
      btn.style.borderColor = "#aaa";
      btn.style.color = "#333";
    }, 1500);
  }

  function copyColumn(table, colIndex, btn) {
    const rows = table.querySelectorAll(".v-table-table tr");
    const values = [];

    rows.forEach((row) => {
      const cells = row.querySelectorAll("td.v-table-cell-content");
      if (cells[colIndex]) {
        const text = cells[colIndex].innerText.trim();
        if (text) values.push(text);
      }
    });

    if (values.length === 0) {
      btn.textContent = "Empty!";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
      return;
    }

    const content = values.join("\n");

    try {
      GM_setClipboard(content, "text");
      showSuccess(btn);
    } catch (e) {
      navigator.clipboard
        .writeText(content)
        .then(() => {
          showSuccess(btn);
        })
        .catch(() => {
          const ta = document.createElement("textarea");
          ta.value = content;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          showSuccess(btn);
        });
    }
  }

  function injectButtons(table) {
    const headerCells = table.querySelectorAll(
      'td[class*="v-table-header-cell"]',
    );

    headerCells.forEach((headerCell, colIndex) => {
      if (headerCell.querySelector(".col-copy-btn")) return;

      const btn = document.createElement("button");
      btn.textContent = "Copy";
      btn.className = "col-copy-btn";
      btn.style.cssText = btnStyle;

      // stopPropagation WITHOUT preventDefault keeps the trusted gesture
      // intact for clipboard, while preventing the event from reaching
      // Vaadin's sort listener on the parent td
      ["mousedown", "pointerdown", "mouseup", "pointerup"].forEach((evt) => {
        btn.addEventListener(evt, (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
          // NO e.preventDefault() here — that's what was breaking clipboard
        });
      });

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        copyColumn(table, colIndex, btn);
      });

      const caption = headerCell.querySelector(".v-table-caption-container");
      if (caption) caption.appendChild(btn);
      else headerCell.appendChild(btn);
    });
  }

  function attachToTable(table) {
    if (table._copyBtnObserver) return;

    injectButtons(table);

    const headerWrap = table.querySelector(".v-table-header-wrap");
    if (headerWrap) {
      const observer = new MutationObserver(() => injectButtons(table));
      observer.observe(headerWrap, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
      table._copyBtnObserver = observer;
    }
  }

  function scanForTables() {
    document.querySelectorAll(".v-table").forEach(attachToTable);
  }

  const rootObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList && node.classList.contains("v-table"))
          attachToTable(node);
        if (node.querySelectorAll)
          node.querySelectorAll(".v-table").forEach(attachToTable);
      }
    }
  });

  rootObserver.observe(document.body, { childList: true, subtree: true });

  scanForTables();
})();
