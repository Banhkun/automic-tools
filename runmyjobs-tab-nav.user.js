// ==UserScript==
// @name         RunMyJobs: Tab & Panel Navigation + Edit Shortcut
// @namespace    bosch-asportal
// @version      1.1
// @description  Tab/Shift+Tab keyboard navigation for UIReact-TabBar elements + E key shortcut for Edit in context menu
// @author       You
// @match        https://runmyjobs-dev1.emea.bosch.com/redwood/ui*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  // ─── Tab & Panel Navigation ───────────────────────────────────────────────

  function getAllTabBarPanels() {
    return Array.from(document.querySelectorAll('.UIReact-TabBar'));
  }

  function getActivePanel() {
    return document.querySelector('.UIReact-TabBar.active');
  }

  function getTabsInPanel(panel) {
    const tabHeadersContainers = Array.from(panel.querySelectorAll('.tabHeaders'));
    const mainTabHeaders = tabHeadersContainers.find(container => {
      return container.className === 'tabHeaders';
    });

    if (!mainTabHeaders) return [];
    return Array.from(mainTabHeaders.querySelectorAll(':scope > .tabHeader:not(.tabOverflow)'));
  }

  function getSelectedTabIndex(panel) {
    const tabs = getTabsInPanel(panel);
    return tabs.findIndex(tab => tab.classList.contains('selected'));
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
    const currentPanelIndex = allPanels.indexOf(activePanel);
    if (currentPanelIndex === -1) return;

    let nextPanelIndex = direction === 'next' ? currentPanelIndex + 1 : currentPanelIndex - 1;

    if (nextPanelIndex >= allPanels.length) {
      nextPanelIndex = 0;
    } else if (nextPanelIndex < 0) {
      nextPanelIndex = allPanels.length - 1;
    }

    const nextPanel = allPanels[nextPanelIndex];
    const nextPanelTabs = getTabsInPanel(nextPanel);

    if (nextPanelTabs.length > 0) {
      setActivePanel(nextPanel);
      const targetIndex = direction === 'next' ? 0 : nextPanelTabs.length - 1;
      selectTab(nextPanel, targetIndex);
    }
  }

  // ─── Edit Context Menu Shortcut ───────────────────────────────────────────

  function clickEditIfMenuVisible() {
    const menu = document.querySelector('[data-testid="UIContextMenu_MainPage"]');
    if (!menu) return;

    const items = menu.querySelectorAll('[data-testid="UIMenuItem"]');
    for (const item of items) {
      const label = item.querySelector('.sc-dmyCSP');
      if (label && label.textContent.trim() === 'Edit...') {
        item.click();
        return;
      }
    }
  }

  // ─── Unified Key Handler ──────────────────────────────────────────────────

  function isTypingContext() {
    const tag = document.activeElement.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable;
  }

  function handleKeyDown(e) {
    // Tab navigation
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      const allPanels = getAllTabBarPanels();
      if (allPanels.length === 0) return;

      e.preventDefault();
      navigate(e.shiftKey ? 'previous' : 'next');
      return;
    }

    // E key → Edit context menu shortcut
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (isTypingContext()) return;
      clickEditIfMenuVisible();
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    const allPanels = getAllTabBarPanels();

    if (allPanels.length === 0) {
      console.log('[RunMyJobs] No UIReact-TabBar elements found on this page.');
    } else {
      const activePanel = getActivePanel();
      if (!activePanel) setActivePanel(allPanels[0]);
      console.log('[RunMyJobs] Tab navigation initialized with ' + allPanels.length + ' panel(s).');
    }

    document.addEventListener('keydown', handleKeyDown);
    console.log('[RunMyJobs] Edit shortcut (E key) active.');
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
      console.error('[RunMyJobs] Observer error:', error);
      const checkInterval = setInterval(() => {
        if (getAllTabBarPanels().length > 0) {
          clearInterval(checkInterval);
          init();
        }
      }, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForElements);
  } else {
    waitForElements();
  }

})();
