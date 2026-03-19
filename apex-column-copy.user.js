// ==UserScript==
// @name         APEX: Column Copy Buttons
// @namespace    bosch-asportal
// @version      1.0
// @description  Adds copy buttons to Interactive Grid and Interactive Report column headers in Oracle APEX
// @author       You
// @match        https://rb-wam.bosch.com/*
// @match        https://apps-p-p1-outsystems.de.bosch.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  function createCopyButton() {
    const button = document.createElement('button');
    button.className = 'apex-column-copy-btn';
    button.innerHTML = '📋';
    button.title = 'Copy column data';
    button.style.cssText = `
      margin-left: 5px;
      padding: 2px 6px;
      border: 1px solid #ccc;
      background: #f5f5f5;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      vertical-align: middle;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.background = '#e0e0e0';
    });

    button.addEventListener('mouseleave', () => {
      button.style.background = '#f5f5f5';
    });

    return button;
  }

  function getIGColumnData(header) {
    const columnIdx = header.getAttribute('data-idx');
    if (columnIdx === null) return [];

    const grid = header.closest('.a-IG');
    if (!grid) return [];

    let rows = grid.querySelectorAll('.a-GV-bdy tbody tr[role="row"]');
    if (rows.length === 0) {
      rows = grid.querySelectorAll('.a-GV-w-scroll tbody tr');
    }

    const data = [];
    rows.forEach((row) => {
      const cell = row.querySelector(`td[data-idx="${columnIdx}"], td:nth-child(${parseInt(columnIdx) + 1})`);
      if (cell) {
        const text = cell.textContent.trim();
        if (text) data.push(text);
      }
    });

    return data;
  }

  function getIRColumnData(header) {
    const columnId = header.id;
    if (!columnId) return [];

    const table = header.closest('table');
    if (!table) return [];

    const headerIndex = Array.from(header.parentElement.children).indexOf(header);
    const tbody = table.querySelector('tbody');
    if (!tbody) return [];

    const rows = tbody.querySelectorAll('tr');
    const data = [];

    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells[headerIndex]) {
        const text = cells[headerIndex].textContent.trim();
        if (text) data.push(text);
      }
    });

    return data;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      return false;
    }
  }

  function showFeedback(button, success = true) {
    const originalText = button.innerHTML;
    button.innerHTML = success ? '✓' : '✗';
    button.style.background = success ? '#4CAF50' : '#f44336';
    button.style.color = 'white';
    button.style.border = 'none';

    setTimeout(() => {
      button.innerHTML = originalText;
      button.style.background = '#f5f5f5';
      button.style.color = '';
      button.style.border = '1px solid #ccc';
    }, 1500);
  }

  async function handleCopyClick(event, header, isIG) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const data = isIG ? getIGColumnData(header) : getIRColumnData(header);

    if (data.length === 0) {
      showFeedback(button, false);
      return;
    }

    const text = data.join('\n');
    const success = await copyToClipboard(text);
    showFeedback(button, success);
  }

  function addCopyButtonToHeader(header, isIG) {
    if (header.querySelector('.apex-column-copy-btn')) return;

    const button = createCopyButton();
    button.addEventListener('click', (e) => handleCopyClick(e, header, isIG));

    const labelSpan = header.querySelector('.a-GV-headerLabel, .a-IRR-headerLabel');
    if (labelSpan) {
      labelSpan.appendChild(button);
    } else {
      header.appendChild(button);
    }
  }

  function processInteractiveGrids() {
    let count = 0;
    document.querySelectorAll('.a-GV').forEach(grid => {
      grid.querySelectorAll('.a-GV-header[data-idx]').forEach(header => {
        addCopyButtonToHeader(header, true);
        count++;
      });
    });
    return count;
  }

  function processInteractiveReports() {
    let count = 0;
    document.querySelectorAll('.a-IRR').forEach(report => {
      report.querySelectorAll('.a-IRR-header').forEach(header => {
        addCopyButtonToHeader(header, false);
        count++;
      });
    });
    return count;
  }

  function init() {
    const igCount = processInteractiveGrids();
    const irCount = processInteractiveReports();
    const total = igCount + irCount;
    if (total > 0) {
      console.log(`[APEX Column Copy] Added copy buttons to ${total} columns (${igCount} IG, ${irCount} IR)`);
    }
  }

  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldReinit = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              if (node.classList && (node.classList.contains('a-GV') || node.classList.contains('a-IRR'))) {
                shouldReinit = true;
              } else if (node.querySelector && (node.querySelector('.a-GV') || node.querySelector('.a-IRR'))) {
                shouldReinit = true;
              }
            }
          });
        }
      }
      if (shouldReinit) setTimeout(init, 100);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(init, 500);
      setupObserver();
    });
  } else {
    setTimeout(init, 500);
    setupObserver();
  }
})();
