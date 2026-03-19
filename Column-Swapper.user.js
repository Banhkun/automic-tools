// ==UserScript==
// @name         AS-Portal: Swap Hierarchy Type ↔ Appointment Date
// @namespace    bosch-asportal
// @version      1.1
// @description  Permanently swaps "Hierarchy Type" and "Appointment Date" columns – works after sort/filter/refresh
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
        if (isSwapping) return;
        isSwapping = true;

        const idx = getColumnIndexes();
        if (!idx) {
            isSwapping = false;
            return false;
        }

        const table = getTable();
        if (!table) {
            isSwapping = false;
            return false;
        }

        swapCells(table.tHead.rows[0], idx.iA, idx.iB);

        table.querySelectorAll('tbody tr').forEach(row => {
            swapCells(row, idx.iA, idx.iB);
        });

        console.log('AS-Portal: Columns swapped (Hierarchy Type ↔ Appointment Date)');
        isSwapping = false;
        return true;
    }

    function trySwapNow(maxRetries = 15, delay = 400) {
        let attempts = 0;
        const interval = setInterval(() => {
            if (performSwap() || ++attempts >= maxRetries) {
                clearInterval(interval);
            }
        }, delay);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(trySwapNow, 800));
    } else {
        setTimeout(trySwapNow, 800);
    }

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
                setTimeout(performSwap, 100);
                break;
            }
        }
    });

    const rootContainer = document.getElementById('b9-REQLIST_1') ||
                          document.querySelector('.os-internal-ui-grid') ||
                          document.body;

    observer.observe(rootContainer, {
        childList: true,
        subtree: true
    });

    document.addEventListener('OSAjaxFinished', () => setTimeout(performSwap, 150), true);

    console.log('AS-Portal Column Swapper v1.1 loaded');
})();
