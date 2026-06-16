// ==UserScript==
// @name         AS-Portal: Swap Hierarchy Type ↔ Appointment Date + Expand List
// @namespace    bosch-asportal
// @version      1.5
// @description  Swaps "Hierarchy Type" and "Appointment Date" columns; expands request list to fill viewport
// @author       You
// @match        https://apps-p-p1-outsystems.de.bosch.com/ASPortal/Welcome*
// @match        https://apps-p-p1-outsystems.de.bosch.com/ASPortal/RequestDetail*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
    'use strict';

    const COL_A = 'Hierarchy Type';
    const COL_B = 'Appointment Date';
    let isSwapping = false;

    // ── CSS injection ─────────────────────────────────────────────────────────
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

    // ── Height expansion ──────────────────────────────────────────────────────
    function expandListContainer() {
        const containers = document.querySelectorAll('[id$="-VRequestList_HasData"]');
        containers.forEach(el => {
            const rect = el.getBoundingClientRect();
            const topOffset = rect.top + window.scrollY;
            const BOTTOM_PADDING = 24;
            const newHeight = `calc(100vh - ${Math.round(topOffset)}px - ${BOTTOM_PADDING}px)`;
            el.style.setProperty('height', newHeight, 'important');
            el.style.setProperty('overflow', 'auto', 'important');
            el.style.setProperty('width', '100%', 'important');
        });
    }

    // ── Header text (text nodes only, ignoring sort-icon child divs) ──────────
    function headerText(th) {
        let text = '';
        th.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
        });
        return text.trim().replace(/\s+/g, ' ');
    }

    // ── Check if the table is fully ready to swap ─────────────────────────────
    // "Ready" means: thead exists, has at least one row, and both target headers
    // are present AND the table has at least one tbody row (i.e. data loaded).
    function getTableIfReady() {
        const table = document.querySelector('table[role="grid"]');
        if (!table || !table.tHead || !table.tHead.rows.length) return null;
        if (!table.tBodies.length || !table.tBodies[0].rows.length) return null;
        return table;
    }

    function getColumnIndexes(table) {
        const headers = Array.from(table.tHead.rows[0].cells);
        const iA = headers.findIndex(th => headerText(th) === COL_A);
        const iB = headers.findIndex(th => headerText(th) === COL_B);
        if (iA === -1 || iB === -1 || iA === iB) return null;
        return { iA, iB };
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

    // ── Core swap — returns true only if it actually ran ──────────────────────
    function performSwap() {
        if (isSwapping) return false;

        const table = getTableIfReady();
        if (!table) return false;

        // Skip if already swapped (guard attribute on thead row)
        if (table.tHead.rows[0].dataset.asSwapped === '1') return true;

        const idx = getColumnIndexes(table);
        if (!idx) return false;

        isSwapping = true;
        swapCells(table.tHead.rows[0], idx.iA, idx.iB);
        table.querySelectorAll('tbody tr').forEach(row => swapCells(row, idx.iA, idx.iB));

        // Mark as swapped so MutationObserver re-triggers don't double-swap
        table.tHead.rows[0].dataset.asSwapped = '1';

        console.log(`[AS-Portal] Columns swapped: [${idx.iA}] ↔ [${idx.iB}]`);
        isSwapping = false;
        return true;
    }

    function applyAll() {
        performSwap();
        expandListContainer();
    }

    // ── Retry loop: keeps going until swap succeeds or max attempts hit ───────
    // Longer delay + more retries to survive slow first-load renders
    function tryApplyNow(maxRetries = 30, delay = 500) {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            const done = performSwap();
            expandListContainer();
            if (done || attempts >= maxRetries) {
                clearInterval(interval);
                if (!done) console.warn('[AS-Portal] Swap gave up after', attempts, 'attempts');
            }
        }, delay);
    }

    // ── Boot ──────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryApplyNow, 1000));
    } else {
        setTimeout(tryApplyNow, 1000);
    }

    // OutSystems AJAX hook — clears the guard so a fresh swap runs after refresh
    document.addEventListener('OSAjaxFinished', () => {
        // Clear guard on any existing thead so performSwap re-runs cleanly
        document.querySelectorAll('table[role="grid"] thead tr').forEach(tr => {
            delete tr.dataset.asSwapped;
        });
        setTimeout(applyAll, 200);
    }, true);

    // MutationObserver — watches for table re-renders
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type !== 'childList' || !mutation.addedNodes.length) continue;
            const hasTableContent = Array.from(mutation.addedNodes).some(node =>
                node.nodeType === 1 && (
                    node.matches?.('table[role="grid"], tbody, tr, td, thead') ||
                    node.querySelector?.('table[role="grid"]')
                )
            );
            if (hasTableContent) {
                // Clear guard in case the whole thead was replaced
                document.querySelectorAll('table[role="grid"] thead tr').forEach(tr => {
                    delete tr.dataset.asSwapped;
                });
                setTimeout(applyAll, 150);
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

    // Also try once on visibilitychange (catches the "switch tab then back" case
    // in case the page was still loading when it was first hidden)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') setTimeout(applyAll, 150);
    });

    console.log('[AS-Portal] Column Swapper + List Expander v1.5 loaded');
})();
