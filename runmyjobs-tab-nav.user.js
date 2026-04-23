// ==UserScript==
// @name         RunMyJobs: Tab & Panel Navigation + Edit Shortcut
// @namespace    bosch-asportal
// @version      1.2
// @description  Tab/Shift+Tab keyboard navigation for UIReact-TabBar elements + E key shortcut for Edit in context menu + Ctrl+S to Save / Ctrl+Shift+S to Save & Close
// @author       You
// @match        https://runmyjobs-dev1.emea.bosch.com/redwood/ui*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  ("use strict");

  // ─── Tab & Panel Navigation ───────────────────────────────────────────────

  function getAllTabBarPanels() {
    return Array.from(document.querySelectorAll(".UIReact-TabBar"));
  }

  function getActivePanel() {
    return document.querySelector(".UIReact-TabBar.active");
  }

  function getTabsInPanel(panel) {
    const tabHeadersContainers = Array.from(
      panel.querySelectorAll(".tabHeaders"),
    );
    const mainTabHeaders = tabHeadersContainers.find((container) => {
      return container.className === "tabHeaders";
    });

    if (!mainTabHeaders) return [];
    return Array.from(
      mainTabHeaders.querySelectorAll(":scope > .tabHeader:not(.tabOverflow)"),
    );
  }

  function getSelectedTabIndex(panel) {
    const tabs = getTabsInPanel(panel);
    return tabs.findIndex((tab) => tab.classList.contains("selected"));
  }

  function selectTab(panel, index) {
    const tabs = getTabsInPanel(panel);
    if (index < 0 || index >= tabs.length) return false;

    tabs.forEach((tab) => tab.classList.remove("selected"));
    tabs[index].classList.add("selected");
    tabs[index].click();
    return true;
  }

  function setActivePanel(panel) {
    getAllTabBarPanels().forEach((p) => p.classList.remove("active"));
    panel.classList.add("active");
  }

  function navigate(direction) {
    const activePanel = getActivePanel();
    if (!activePanel) return;

    const tabs = getTabsInPanel(activePanel);
    const currentIndex = getSelectedTabIndex(activePanel);
    if (currentIndex === -1) return;

    const nextIndex =
      direction === "next" ? currentIndex + 1 : currentIndex - 1;

    if (nextIndex >= 0 && nextIndex < tabs.length) {
      selectTab(activePanel, nextIndex);
      return;
    }

    const allPanels = getAllTabBarPanels();
    const currentPanelIndex = allPanels.indexOf(activePanel);
    if (currentPanelIndex === -1) return;

    let nextPanelIndex =
      direction === "next" ? currentPanelIndex + 1 : currentPanelIndex - 1;

    if (nextPanelIndex >= allPanels.length) {
      nextPanelIndex = 0;
    } else if (nextPanelIndex < 0) {
      nextPanelIndex = allPanels.length - 1;
    }

    const nextPanel = allPanels[nextPanelIndex];
    const nextPanelTabs = getTabsInPanel(nextPanel);

    if (nextPanelTabs.length > 0) {
      setActivePanel(nextPanel);
      const targetIndex = direction === "next" ? 0 : nextPanelTabs.length - 1;
      selectTab(nextPanel, targetIndex);
    }
  }

  // ─── Edit Context Menu Shortcut ───────────────────────────────────────────
  function clickMenuItemByLabel(label) {
    const menu = document.querySelector(
      '[data-testid="UIContextMenu_MainPage"]',
    );
    if (!menu) return false;

    const items = menu.querySelectorAll('[data-testid="UIMenuItem"]');
    for (const item of items) {
      const el = item.querySelector(".sc-dmyCSP");
      if (el && el.textContent.trim() === label) {
        item.click();
        return true;
      }
    }
    return false;
  }

  // ─── Save / Save & Close Shortcuts ───────────────────────────────────────

  function findButtonByText(text) {
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      if (btn.textContent.trim() === text && !btn.disabled) {
        return btn;
      }
    }
    return null;
  }

  function clickSave() {
    const btn = findButtonByText("Save");
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  function clickSaveAndClose() {
    const btn =
      findButtonByText("Save and Close") || findButtonByText("Save & Close");
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  // ─── Close Current Tab ────────────────────────────────────────────────────

  function closeCurrentTab() {
    const allPanels = getAllTabBarPanels();
    const activePanel = getActivePanel();
    if (!activePanel) return;

    // Find the selected tab header in the second tabHeaders (the interactive one with buttons)
    const tabHeadersContainers = Array.from(
      activePanel.querySelectorAll(".tabHeaders"),
    );
    const mainTabHeaders = tabHeadersContainers.find(
      (c) => c.className === "tabHeaders",
    );
    if (!mainTabHeaders) return;

    const selectedTab = mainTabHeaders.querySelector(".tabHeader.selected");
    if (!selectedTab) return;

    const closeBtn = selectedTab.querySelector(
      'button.IMAGE_AETHER_CLOSE, button[class*="IMAGE_AETHER_CLOSE"]',
    );
    if (closeBtn) closeBtn.click();
  }
  // ─── Unified Key Handler ──────────────────────────────────────────────────

  function isTypingContext() {
    const tag = document.activeElement.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      document.activeElement.isContentEditable
    );
  }

  function handleKeyDown(e) {
    const key = e.key.toLowerCase();

    // Tab navigation
    if (key === "tab" && !e.ctrlKey && !e.altKey) {
      const allPanels = getAllTabBarPanels();
      if (allPanels.length === 0) return;
      e.preventDefault();
      navigate(e.shiftKey ? "previous" : "next");
      return;
    }

    // Ctrl shortcuts
    if (e.ctrlKey && !e.altKey) {
      switch (key) {
        case "e":
          e.preventDefault();
          e.stopImmediatePropagation();
          clickSaveAndClose();
          return;
        case "s":
          e.preventDefault();
          e.stopImmediatePropagation();
          clickSave();
          return;
        case "q":
          e.preventDefault();
          e.stopImmediatePropagation();
          closeCurrentTab();
          return;
      }
      return; // don't fall through to plain key handlers
    }

    // Plain key shortcuts (no ctrl/alt/shift)
    if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (isTypingContext()) return;

      const contextMenuShortcuts = {
        e: "Edit...",
        d: "Duplicate...",
        o: "⧉ Interact with Definition Object Tags",
      };

      if (contextMenuShortcuts[key]) {
        clickMenuItemByLabel(contextMenuShortcuts[key]);
      }
    }
  }
  // ─── HINT ─────────────────────────────────────────────────────────────────
  function addContextMenuHints() {
    function applyHints(menu) {
      const hints = {
        "Edit...": "E",
        "Duplicate...": "D",
        "⧉ Interact with Definition Object Tags": "O",
      };
      const items = menu.querySelectorAll('[data-testid="UIMenuItem"]');
      if (items.length === 0) return;

      for (const item of items) {
        const el = item.querySelector(".sc-dmyCSP");
        if (!el) continue;
        const label = el.textContent.trim();
        if (!hints[label]) continue;
        if (item.dataset.hintDone) continue;
        item.dataset.hintDone = "true";

        // Modify item layout, not el
        item.style.cssText +=
          "display:flex !important; justify-content:space-between !important; align-items:center !important;";

        const badge = document.createElement("span");
        badge.textContent = hints[label];
        badge.style.cssText = `
          margin-left: auto !important;
          padding: 1px 5px !important;
          font-size: 11px !important;
          font-weight: bold !important;
          font-family: monospace !important;
          color: white !important;
          opacity: 0.8 !important;
          pointer-events: none !important;
        `;
        // Append to item, not el
        item.appendChild(badge);
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;

          let menu = null;
          if (node.dataset?.testid === "UIContextMenu_MainPage") {
            menu = node;
          } else {
            menu = node.querySelector?.('[data-testid="UIContextMenu_MainPage"]');
          }

          if (menu) {
            const innerObserver = new MutationObserver(() => {
              const items = menu.querySelectorAll('[data-testid="UIMenuItem"]');
              if (items.length > 0) {
                innerObserver.disconnect();
                applyHints(menu);
              }
            });
            innerObserver.observe(menu, { childList: true, subtree: true });
            applyHints(menu);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }
  function addButtonBarHints() {
    const saveBtn = document.querySelector('[data-testid="UIButton_Save"]');
    const saveCloseBtn = document.querySelector(
      '[data-testid="UIButton_SaveClose"]',
    );

    if (saveBtn && !saveBtn.dataset.hintAdded) {
      saveBtn.dataset.hintAdded = "true";
      const hint = document.createElement("span");
      hint.textContent = "Ctrl+S";
      hint.style.cssText =
        "font-size:4px; opacity:0.6; font-family:monospace; margin-left:4px; pointer-events:none;";
      saveBtn.insertAdjacentElement("afterend", hint); // outside the button
    }

    if (saveCloseBtn && !saveCloseBtn.dataset.hintAdded) {
      saveCloseBtn.dataset.hintAdded = "true";
      const hint = document.createElement("span");
      hint.textContent = "Ctrl+E";
      hint.style.cssText =
        "font-size:4px; opacity:0.6; font-family:monospace; margin-left:4px; pointer-events:none;";
      saveCloseBtn.insertAdjacentElement("afterend", hint); // outside the button
    }
  }
  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    const allPanels = getAllTabBarPanels();

    if (allPanels.length === 0) {
      console.log("[RunMyJobs] No UIReact-TabBar elements found on this page.");
    } else {
      const activePanel = getActivePanel();
      if (!activePanel) setActivePanel(allPanels[0]);
      console.log(
        "[RunMyJobs] Tab navigation initialized with " +
          allPanels.length +
          " panel(s).",
      );
    }

    document.addEventListener("keydown", handleKeyDown, true);
    console.log("[RunMyJobs] Edit shortcut (E key) active.");
    console.log("[RunMyJobs] Save shortcuts (Ctrl+S / Ctrl+E) active.");

    // Watch for context menu and button bar appearing
    const uiObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (
            node.matches?.('[data-testid="UIContextMenu_MainPage"]') ||
            node.querySelector?.('[data-testid="UIContextMenu_MainPage"]')
          ) {
            addContextMenuHints();
          }
          if (
            node.matches?.('[data-testid="UIButton_Save"]') ||
            node.querySelector?.('[data-testid="UIButton_Save"]')
          ) {
            addButtonBarHints();
          }
        }
      }
    });
    uiObserver.observe(document.body, { childList: true, subtree: true });

    // Run once immediately in case already present
    addContextMenuHints();
    addButtonBarHints();
  }

  function waitForElements() {
    if (!document.body) {
      setTimeout(waitForElements, 50);
      return;
    }

    if (getAllTabBarPanels().length > 0) {
      init();
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      if (getAllTabBarPanels().length > 0) {
        obs.disconnect();
        init();
      }
    });

    try {
      observer.observe(document.body, { childList: true, subtree: true });
    } catch (error) {
      console.error("[RunMyJobs] Observer error:", error);
      const checkInterval = setInterval(() => {
        if (getAllTabBarPanels().length > 0) {
          clearInterval(checkInterval);
          init();
        }
      }, 500);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForElements);
  } else {
    waitForElements();
  }
})();
