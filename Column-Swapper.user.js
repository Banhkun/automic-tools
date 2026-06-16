// ==UserScript==
// @name         AS-Portal: Swap Hierarchy Type ↔ Appointment Date + Expand List
// @namespace    bosch-asportal
// @version      1.3
// @description  Swaps "Hierarchy Type" and "Appointment Date" columns; expands request list to fill viewport
// @author       You
// @match        https://apps-p-p1-outsystems.de.bosch.com/ASPortal/Welcome*
// @match        https://apps-p-p1-outsystems.de.bosch.com/ASPortal/RequestDetail*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
    'use strict';

    // ── Column swap config ────────────────────────────────────────────────────
    const COL_A = 'Hierarchy Type';
    const COL_B = 'Appointment Date';
    let isSwapping = false;

    // ── Inject persistent CSS overrides (no GM_addStyle needed) ──────────────
    function injectCSS(css) {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    injectCSS(`
        [id$="-VRequestList_HasData"] {
            width: 100% !important;
            min-width: 0 !important;
            box-sizing: border-box !important;
        }
        [id$="-WORKAREA2"],
        [id$="-REQLIST_MYREQUESTS"] {
            width: 100% !important;
        }
        [id$="-VRequestList_HasData"] table {
            width: 100% !important;
        }
    `);

    // ── Expand the list container height ─────────────────────────────────────
    function expandListContainer() {
        const containers = document.querySelectorAll('[id$="-VRequestList_HasData"]');
        containers.forEach(el => {
            const rect = el.getBoundingClientRect();
            const topOffset = rect.top + window.scrollY;
            const BOTTOM_PADDING = 24;
            const newHeight = `calc(100vh - ${Math.round(topOffset)}px - ${BOTTOM_PADDING}px)`;

            if (el.style.height !== newHeight || el.style.overflow !== 'auto') {
                el.style.setProperty('height', newHeight, 'important');
                el.style.setProperty('overflow', 'auto', 'important');
                el.style.setProperty('width', '100%', 'important');
            }
        });
    }

    // ── Column swap helpers ───────────────────────────────────────────────────
    function getTable() {
        return document.querySelector('table[role="grid"]');
    }

    function getColumnIndexes() {
        const table = getTable();
        if (!table || !table.tHead) return null;
        const headers = Array.from(table.tHead.rows[0].cells);
        const iA = headers.findIndex(th => th.textContent.trim() === COL_A);
        const iB = headers.findIndex(th => th.textContent.trim() === COL_B);
        return (iA > -1 && iB > -1 && iA !== iB) ? { iA, iB } : null;
    }

    function swapCells(row, i1, i2) {
        if (!row.cells[i1] || !row.cells[i2]) return;
        [row.cells[i1].innerHTML, row.cells[i2].innerHTML] =
            [row.cells[i2].innerHTML, row.cells[i1].innerHTML];
        const h1 = row.cells[i1].getAttribute('data-header');
        const h2 = row.cells[i2].getAttribute('data-header');
        if (h1 && h2) {
            row.cells[i1].setAttribute('data-header', h2);
            row.cells[i2].setAttribute('data-header', h1);
        }
    }

    function performSwap() {
        if (isSwapping) return false;
        isSwapping = true;
        const idx = getColumnIndexes();
        if (!idx) { isSwapping = false; return false; }
        const table = getTable();
        if (!table) { isSwapping = false; return false; }
        swapCells(table.tHead.rows[0], idx.iA, idx.iB);
        table.querySelectorAll('tbody tr').forEach(row => swapCells(row, idx.iA, idx.iB));
        console.log('[AS-Portal] Columns swapped');
        isSwapping = false;
        return true;
    }

    // ── Combined: swap + expand ───────────────────────────────────────────────
    function applyAll() {
        performSwap();
        expandListContainer();
    }

    function tryApplyNow(maxRetries = 15, delay = 400) {
        let attempts = 0;
        const interval = setInterval(() => {
            const swapped = performSwap();
            expandListContainer();
            if (swapped || ++attempts >= maxRetries) clearInterval(interval);
        }, delay);
    }

    // ── Boot ──────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryApplyNow, 800));
    } else {
        setTimeout(tryApplyNow, 800);
    }

    document.addEventListener('OSAjaxFinished', () => setTimeout(applyAll, 150), true);

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type !== 'childList' || !mutation.addedNodes.length) continue;
            const hasTableContent = Array.from(mutation.addedNodes).some(node =>
                node.nodeType === 1 && (
                    node.matches?.('table[role="grid"], tbody, tr, td') ||
                    node.querySelector?.('table[role="grid"]')
                )
            );
            if (hasTableContent) {
                setTimeout(applyAll, 100);
                break;
            }
        }
    });

    const rootContainer =
        document.getElementById('b11-REQLIST_MYREQUESTS') ||
        document.querySelector('.os-internal-ui-grid') ||
        document.body;

    observer.observe(rootContainer, { childList: true, subtree: true });

    window.addEventListener('resize', expandListContainer, { passive: true });

    console.log('[AS-Portal] Column Swapper + List Expander v1.3 loaded');
})();
