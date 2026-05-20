// ==UserScript==
// @name         RunMyJobs: Tab & Panel Navigation + Shortcuts
// @namespace    bosch-asportal
// @version      1.3
// @description  Tab/Shift+Tab navigation, context menu shortcuts, Ctrl+S/E/Q
// @author       Minh Dinh
// @include      https://runmyjobs-*.emea.bosch.com/redwood/ui*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────

  const CONTEXT_MENU_SHORTCUTS = {
    'e': 'Edit...',
    'x': 'Edit as XML...',
    'd': 'Duplicate...',
    'o': '⧉ Interact with Definition Object Tags',
  };

  const CONTEXT_MENU_HINTS = {
    'Edit...': 'E',
    'Edit as XML...': 'X',
    'Duplicate...': 'D',
    '⧉ Interact with Definition Object Tags': 'O',
  };
  // ─── Edit Job Definition Dialog ───────────────────────────────────────────

  function isEditJobDialogOpen() {
    // Matches the header text "Edit Job Definition - ..."
    for (const el of document.querySelectorAll('[data-testid="UIText"]')) {
      if (el.textContent.startsWith('Edit Job Definition')) return true;
    }
    return false;
  }
  // ─── Job Chain Dialog ─────────────────────────────────────────────────────

  function isJobChainDialogOpen() {
    return !!document.querySelector('#JobChainCallDialog');
  }

  function clickEditJob() {
    document
      .querySelector("#JobChainCallDialog button:has(.ULButton-Label)")
      ?.click();
  }

  function applyJobChainDialogHints(dialog) {
    const btn = dialog.querySelector("button:has(.ULButton-Label)");
    if (!btn || btn.dataset.hintDone) return;

    btn.dataset.hintDone = "true";
    btn.style.cssText +=
      "display:inline-flex !important; align-items:center !important; gap:6px !important;";

    const badge = document.createElement("span");
    badge.textContent = "E";
    badge.style.cssText = `
    padding: 1px 5px !important;
    font-size: 11px !important;
    font-weight: bold !important;
    font-family: monospace !important;
    color: black !important;
    opacity: 0.8 !important;
    pointer-events: none !important;
    line-height: 1 !important;
    align-self: center !important;
  `;
    btn.appendChild(badge);
  }
  // ─── Tab & Panel Navigation ───────────────────────────────────────────────

  function getAllTabBarPanels() {
    return Array.from(document.querySelectorAll('.UIReact-TabBar'));
  }

  function getActivePanel() {
    return document.querySelector('.UIReact-TabBar.active');
  }

  function getTabsInPanel(panel) {
    const mainTabHeaders = Array.from(panel.querySelectorAll('.tabHeaders'))
      .find(c => c.className === 'tabHeaders');
    if (!mainTabHeaders) return [];
    return Array.from(mainTabHeaders.querySelectorAll(':scope > .tabHeader:not(.tabOverflow)'));
  }

  function getSelectedTabIndex(panel) {
    return getTabsInPanel(panel).findIndex(tab => tab.classList.contains('selected'));
  }

  function selectTab(panel, index) {
    const tabs = getTabsInPanel(panel);
    if (index < 0 || index >= tabs.length) return false;
    tabs.forEach(tab => tab.classList.remove('selected'));
    tabs[index].classList.add('selected');
    tabs[index].click();
    return true;
  }

  function setActivePanel(panel) {
    getAllTabBarPanels().forEach(p => p.classList.remove('active'));
    panel.classList.add('active');
  }

  function navigate(direction) {
    const activePanel = getActivePanel();
    if (!activePanel) return;

    const tabs = getTabsInPanel(activePanel);
    const currentIndex = getSelectedTabIndex(activePanel);
    if (currentIndex === -1) return;

    const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex >= 0 && nextIndex < tabs.length) {
      selectTab(activePanel, nextIndex);
      return;
    }

    const allPanels = getAllTabBarPanels();
    let nextPanelIndex = allPanels.indexOf(activePanel) + (direction === 'next' ? 1 : -1);
    if (nextPanelIndex >= allPanels.length) nextPanelIndex = 0;
    else if (nextPanelIndex < 0) nextPanelIndex = allPanels.length - 1;

    const nextPanel = allPanels[nextPanelIndex];
    const nextPanelTabs = getTabsInPanel(nextPanel);
    if (nextPanelTabs.length > 0) {
      setActivePanel(nextPanel);
      selectTab(nextPanel, direction === 'next' ? 0 : nextPanelTabs.length - 1);
    }
  }

  // ─── Context Menu ─────────────────────────────────────────────────────────

  function clickMenuItemByLabel(label) {
    const menu = document.querySelector('[data-testid="UIContextMenu_MainPage"]');
    if (!menu) return false;
    for (const item of menu.querySelectorAll('[data-testid="UIMenuItem"]')) {
      const el = item.querySelector('.sc-dmyCSP');
      if (el?.textContent.trim() === label) {
        item.click();
        return true;
      }
    }
    return false;
  }

  function applyContextMenuHints(menu) {
    for (const item of menu.querySelectorAll('[data-testid="UIMenuItem"]')) {
      const el = item.querySelector('.sc-dmyCSP');
      if (!el || item.dataset.hintDone) continue;
      const hint = CONTEXT_MENU_HINTS[el.textContent.trim()];
      if (!hint) continue;

      item.dataset.hintDone = 'true';
      item.style.cssText += 'display:flex !important; justify-content:space-between !important; align-items:center !important;';

      const badge = document.createElement('span');
      badge.textContent = hint;
      badge.style.cssText = `
        font-size: 10px !important;
        opacity: 0.6 !important;
        font-family: monospace !important;
        pointer-events: none !important;
        margin-top: 2px !important;
        text-align: center !important;
      `;
      item.appendChild(badge);
    }
  }

  // ─── Button Bar ───────────────────────────────────────────────────────────

  function findButtonByText(text) {
    for (const btn of document.querySelectorAll('button, [role="button"]')) {
      if (btn.textContent.trim().startsWith(text) && !btn.disabled) return btn;
    }
    return null;
  }

  function clickSave() {
    return findButtonByText('Save')?.click() ?? false;
  }

  function clickSaveAndClose() {
    return (findButtonByText('Save and Close') ?? findButtonByText('Save & Close'))?.click() ?? false;
  }

  function addButtonBarHints() {
    function wrapWithHint(btn, hintText) {
      if (!btn || btn.dataset.hintAdded) return;
      if (btn.closest(".JobChainEditor")) return;

      // Don't touch btn's position in the DOM at all.
      // Just insert a hint element right after it.
      const parent = btn.parentNode;
      if (!parent || !parent.contains(btn)) return;

      btn.dataset.hintAdded = "true";

      try {
        const hint = document.createElement("span");
        hint.textContent = hintText;
        hint.dataset.rmjHint = "true";
        hint.style.cssText = `
      display: block !important;
      font-size: 10px !important;
      opacity: 0.6 !important;
      font-family: monospace !important;
      pointer-events: none !important;
      text-align: center !important;
    `;
        btn.insertAdjacentElement("afterend", hint);
      } catch {
        btn.dataset.hintAdded = "";
      }
    }
    wrapWithHint(document.querySelector('[data-testid="UIButton_Save"]'), 'Ctrl+S');
    wrapWithHint(document.querySelector('[data-testid="UIButton_SaveClose"]'), 'Ctrl+E');
  }

  // ─── Close Tab ────────────────────────────────────────────────────────────

  function closeCurrentTab() {
  const activePanel = getActivePanel();
  if (!activePanel) return;

  const tabs = getTabsInPanel(activePanel);
  const currentIndex = getSelectedTabIndex(activePanel);
  if (currentIndex === -1) return;

  // Select left neighbor first, fall back to right
  const targetIndex = currentIndex > 0 ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex >= 0 && targetIndex < tabs.length) {
    selectTab(activePanel, targetIndex);
  }

  // Now close the original tab
  const mainTabHeaders = Array.from(activePanel.querySelectorAll('.tabHeaders'))
    .find(c => c.className === 'tabHeaders');
  if (!mainTabHeaders) return;
  const closeBtn = mainTabHeaders
    .querySelector('.tabHeader:nth-child(' + (currentIndex + 1) + ') button[class*="IMAGE_AETHER_CLOSE"]');
  closeBtn?.click();
}

  // ─── Key Handler ──────────────────────────────────────────────────────────

  function isTypingContext() {
  const el = document.activeElement;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  function handleKeyDown(e) {
    const key = e.key.toLowerCase();

    if (key === "tab" && !e.ctrlKey && !e.altKey && !isTypingContext()) {
      const allPanels = getAllTabBarPanels();
      if (allPanels.length === 0) return;
      // Let browser handle Tab natively inside Edit Job Definition dialog
      if (isEditJobDialogOpen()) return;

      e.preventDefault();
      navigate(e.shiftKey ? "previous" : "next");
      return;
    }

    if (e.ctrlKey && !e.altKey) {
      switch (key) {
        case 'e': e.preventDefault(); e.stopImmediatePropagation(); clickSaveAndClose(); return;
        case 's': e.preventDefault(); e.stopImmediatePropagation(); clickSave(); return;
        case 'q': e.preventDefault(); e.stopImmediatePropagation(); closeCurrentTab(); return;
      }
      return;
    }

    if (!e.ctrlKey && !e.altKey && !e.shiftKey && !isTypingContext()) {
      // Job chain dialog shortcuts take priority
      if (isJobChainDialogOpen()) {
        if (key === "e") {
          e.preventDefault();
          clickEditJob();
          return;
        }
      }
      const label = CONTEXT_MENU_SHORTCUTS[key];
      if (label) clickMenuItemByLabel(label);
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    const allPanels = getAllTabBarPanels();
    if (allPanels.length > 0) {
      if (!getActivePanel()) setActivePanel(allPanels[0]);
      console.log(`[RunMyJobs] Initialized with ${allPanels.length} panel(s).`);
    } else {
      console.log('[RunMyJobs] No UIReact-TabBar elements found.');
    }

    document.addEventListener('keydown', handleKeyDown, true);

    // Single observer for all dynamic UI
    const observer = new MutationObserver((mutations) => {
      for (const { addedNodes } of mutations) {
        for (const node of addedNodes) {
          if (node.nodeType !== 1) continue;

          // Context menu container added
          const menu =
            node.dataset?.testid === "UIContextMenu_MainPage"
              ? node
              : node.querySelector?.('[data-testid="UIContextMenu_MainPage"]');

          if (menu) {
            // Watch inside menu for items to render
            const inner = new MutationObserver(() => {
              if (
                menu.querySelectorAll('[data-testid="UIMenuItem"]').length > 0
              ) {
                inner.disconnect();
                applyContextMenuHints(menu);
              }
            });
            inner.observe(menu, { childList: true, subtree: true });
            applyContextMenuHints(menu); // try immediately too
          }

          // Save buttons added
          if (
            node.matches?.('[data-testid="UIButton_Save"]') ||
            node.querySelector?.('[data-testid="UIButton_Save"]')
          ) {
            addButtonBarHints();
          }
          // Job chain dialog added   ← new
          const dialog =
            node.id === "JobChainCallDialog"
              ? node
              : node.querySelector?.("#JobChainCallDialog");

          if (dialog) {
            applyJobChainDialogHints(dialog);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    addButtonBarHints();

    console.log('[RunMyJobs] Shortcuts active: E/D/O (context menu), Ctrl+S, Ctrl+E, Ctrl+Q.');
  }

  function waitForElements() {
    if (!document.body) { setTimeout(waitForElements, 50); return; }

    if (getAllTabBarPanels().length > 0) { init(); return; }

    const observer = new MutationObserver((_, obs) => {
      if (getAllTabBarPanels().length > 0) { obs.disconnect(); init(); }
    });

    try {
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
      console.error('[RunMyJobs] Observer error:', e);
      const t = setInterval(() => {
        if (getAllTabBarPanels().length > 0) { clearInterval(t); init(); }
      }, 500);
    }
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', waitForElements)
    : waitForElements();

})();
