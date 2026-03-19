// ==UserScript==
// @name         RunMyJobs: Tab & Panel Navigation
// @namespace    bosch-asportal
// @version      1.0
// @description  Tab/Shift+Tab keyboard navigation for UIReact-TabBar elements in RunMyJobs Redwood UI
// @author       You
// @match        https://runmyjobs-dev1.emea.bosch.com/redwood/ui*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

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

  function handleKeyDown(e) {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      const allPanels = getAllTabBarPanels();
      if (allPanels.length === 0) return;

      e.preventDefault();
      navigate(e.shiftKey ? 'previous' : 'next');
    }
  }

  function init() {
    const allPanels = getAllTabBarPanels();
    if (allPanels.length === 0) {
      console.log('[RunMyJobs Tab Nav] No UIReact-TabBar elements found on this page.');
      return;
    }

    const activePanel = getActivePanel();
    if (!activePanel && allPanels.length > 0) {
      setActivePanel(allPanels[0]);
    }

    document.addEventListener('keydown', handleKeyDown);
    console.log('[RunMyJobs Tab Nav] Initialized with ' + allPanels.length + ' panel(s).');
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
      console.error('[RunMyJobs Tab Nav] Observer error:', error);
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
