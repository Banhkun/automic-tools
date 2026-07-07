// ==UserScript==
// @name         RMJ-ASPortal Cross Tab Control
// @namespace    bosch-tools
// @version      3.6
// @include      *://runmyjobs-dev*.*/*
// @include      *://*/ASPortal/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_addValueChangeListener
// ==/UserScript==

(function () {
  'use strict';

  const isRMJ = location.hostname.includes('runmyjobs');
  const isASPortal = location.hostname.includes('outsystems');

  // ── RMJ side ──
  if (isRMJ) {

    function findInputByLabel(labelText) {
      const labels = document.querySelectorAll('[data-testid="UILabel"]');
      for (const label of labels) {
        if (label.textContent.trim() === labelText) {
          const row = label.closest('[data-testid="UILabelField"]');
          return row?.querySelector('[data-testid="UITextInput"]') || null;
        }
      }
      return null;
    }

    // ── Request ID suggestions (from live ASPortal tabs) ──

    function ensureRequestIdDatalist() {
      let dl = document.getElementById('asp-request-id-list');
      if (!dl) {
        dl = document.createElement('datalist');
        dl.id = 'asp-request-id-list';
        document.body.appendChild(dl);
      }
      return dl;
    }

    function getOpenRequestIds() {
      const keys = GM_listValues().filter(k => k.startsWith('asportal_heartbeat_'));
      const now = Date.now();
      const out = [];
      for (const k of keys) {
        const raw = GM_getValue(k);
        if (!raw) continue;
        try {
          const hb = JSON.parse(raw);
          if (hb.requestId && (now - hb.ts < 10000)) out.push(hb);
        } catch (e) {
          // ignore malformed/stale entries
        }
      }
      return out;
    }

    function refreshRequestIdDatalist() {
      const dl = ensureRequestIdDatalist();
      const open = getOpenRequestIds();
      dl.innerHTML = open.map(hb => {
        const label = hb.title ? `${hb.requestId} - ${hb.title}` : hb.requestId;
        return `<option value="${hb.requestId}">${label}</option>`;
      }).join('');
    }

    function injectRMJUI() {
      if (document.getElementById('asp-fetch-btn')) return;

      const requestIdInput = findInputByLabel('Request ID');
      const callsInput = findInputByLabel('Calls');
      if (!requestIdInput || !callsInput) return;

      // Wire up suggestions on the Request ID field
      requestIdInput.setAttribute('list', 'asp-request-id-list');
      requestIdInput.setAttribute('autocomplete', 'off');
      ensureRequestIdDatalist();
      refreshRequestIdDatalist();

      // ── Button next to Request ID ──
      const btn = document.createElement('button');
      btn.id = 'asp-fetch-btn';
      btn.textContent = '📋 Fetch from ASPortal';
      btn.style.cssText = `
        margin-left: 8px;
        padding: 3px 10px;
        font-size: 12px;
        cursor: pointer;
        border: 1px solid #aaa;
        border-radius: 4px;
        background: #e8f0fe;
        white-space: nowrap;
        flex-shrink: 0;
      `;

      btn.addEventListener('click', () => {
        const requestId = requestIdInput.value.trim();
        if (!requestId) {
          alert('Please enter a Request ID first');
          return;
        }
        btn.textContent = '⏳ Waiting...';
        btn.disabled = true;

        const command = JSON.stringify({
          action: 'click_and_parse',
          requestId,
          ts: Date.now()
        });

        const heartbeat = GM_getValue('asportal_heartbeat_' + requestId);
        const heartbeatData = heartbeat ? JSON.parse(heartbeat) : null;

        console.log('[RMJ] heartbeat requestId:', heartbeatData?.requestId, '| input requestId:', requestId);
        console.log('[RMJ] age:', heartbeatData ? Date.now() - heartbeatData.ts : 'N/A', 'ms');

        // RMJ side — loosen the staleness window to tolerate background-tab throttling
        const isAlive = heartbeatData &&
                (Date.now() - heartbeatData.ts < 45000) &&   // was 10000
                String(heartbeatData.requestId) === String(requestId);

        if (!isAlive) {
          console.log('[RMJ] ASPortal tab not found for RequestId:', requestId, '— opening...');
          GM_openInTab(
                `https://apps-p-p1-outsystems.de.bosch.com/ASPortal/RequestDetail?RequestId=${requestId}`,
                { active: false, insert: true }  // active: false = open in background
            );
          setTimeout(() => {
            GM_setValue('asportal_command', command);
            console.log('[RMJ] Command sent after tab open delay');
          }, 4000);
        } else {
          GM_setValue('asportal_command', command);
          console.log('[RMJ] Command sent to existing ASPortal tab');
        }
      });

      const inputWrapper = requestIdInput.closest('.ULGenericInput');
      inputWrapper?.parentElement?.appendChild(btn);

      // ── Replace Calls input with a textarea ──
      const callsWrapper = callsInput.closest('[data-testid="UILabelField"]');
      if (callsWrapper) {
        callsWrapper.style.alignItems = 'flex-start';
        callsWrapper.style.overflow = 'visible';
        callsWrapper.style.flex = '1 1 auto';
        callsWrapper.style.minWidth = '0';
      }

      const callsContent = callsInput.closest('[data-testid="UILabelField"] .Content');
      if (callsContent) {
        callsContent.style.overflow = 'visible';
        callsContent.style.flex = '1 1 auto';
        callsContent.style.minWidth = '0';
        callsContent.style.width = '100%';
      }

      const callsGenericInput = callsInput.closest('[data-testid="UIGenericInput"]');
      if (callsGenericInput) {
        callsGenericInput.style.overflow = 'visible';
        callsGenericInput.style.flex = '1 1 auto';
        callsGenericInput.style.minWidth = '0';
        callsGenericInput.style.width = '100%';
      }

      const callsInputDiv = callsInput.closest('.InlineInputDiv');
      if (callsInputDiv) {
        callsInputDiv.style.overflow = 'visible';
        callsInputDiv.style.flex = '1 1 auto';
        callsInputDiv.style.minWidth = '0';
        callsInputDiv.style.width = '100%';
      }

      // Walk up and unlock all ancestors until ULTabBarContainer
      let el = callsInput.parentElement;
      while (el && !el.classList.contains('ULTabBarContainer')) {
        if (el.style) {
          el.style.overflow = 'visible';
          el.style.minWidth = '0';
          if (el.style.flex && el.style.flex.includes('0 0')) {
            el.style.flex = '1 1 auto';
          }
          if (el.style.width && !el.style.width.includes('%') && el.style.width !== '100%') {
            el.style.width = '100%';
          }
        }
        el = el.parentElement;
      }

      const textarea = document.createElement('textarea');
      textarea.id = 'asp-calls-textarea';
      textarea.setAttribute('autocomplete', 'off');
      textarea.style.cssText = `
        width: 100%;
        min-height: 300px;
        height: 300px;
        max-height: 600px;
        resize: both;
        overflow: auto;
        font-family: monospace;
        font-size: 11px;
        line-height: 1.5;
        white-space: pre;
        background: #1e1e1e;
        color: #d4d4d4;
        border: 1px solid #555;
        border-radius: 4px;
        padding: 8px;
        box-sizing: border-box;
      `;

      textarea.addEventListener('input', () => {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(callsInput, textarea.value);
        callsInput.dispatchEvent(new Event('input', { bubbles: true }));
        callsInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      callsInput.style.display = 'none';
      callsInput.parentElement.appendChild(textarea);

      console.log('[RMJ] UI injected');
    }

    // Result handling is now event-driven via GM_addValueChangeListener
    // instead of a 500ms poll — fires immediately when ASPortal writes
    // 'asportal_result', with no dependency on this tab being focused.
    function handleResult(result) {
      const callsInput = findInputByLabel('Calls');
      const btn = document.getElementById('asp-fetch-btn');

      if (callsInput) {
        const formatted = JSON.stringify(result.data, null, 2);
        const ta = document.getElementById('asp-calls-textarea');
        if (ta) ta.value = formatted;
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(callsInput, formatted);
        callsInput.dispatchEvent(new Event('input', { bubbles: true }));
        callsInput.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[RMJ] Calls field populated');
      }
      if (btn) {
        btn.textContent = '📋 Fetch from ASPortal';
        btn.disabled = false;
      }
    }

    GM_addValueChangeListener('asportal_result', (name, oldValue, newValue, remote) => {
      if (!newValue) return;
      const result = JSON.parse(newValue);
      GM_setValue('asportal_result', '');
      handleResult(result);
    });

    function watchForDialog() {
      const observer = new MutationObserver(() => {
        const requestIdInput = findInputByLabel('Request ID');
        if (requestIdInput && !document.getElementById('asp-fetch-btn')) {
          injectRMJUI();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    watchForDialog();

    // Keep suggestions fresh even while the dialog is already open
    refreshRequestIdDatalist();
    setInterval(refreshRequestIdDatalist, 2000);
  }

  // ── ASPortal side ──
  if (isASPortal) {

    function getCurrentRequestId() {
      return new URLSearchParams(location.search).get('RequestId');
    }

    function waitFor(conditionFn, callback, timeoutMs = 15000) {
      if (conditionFn()) { callback(); return; }

      let settled = false;
      let timeoutId = null;

      const observer = new MutationObserver(() => {
        if (settled) return;
        if (conditionFn()) {
          settled = true;
          observer.disconnect();
          clearTimeout(timeoutId);
          callback();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        console.warn('[ASPortal] waitFor timed out, parsing anyway');
        callback();
      }, timeoutMs);
    }

    function parseRequestInfo() {
      const get = (selector) => document.querySelector(selector)?.textContent?.trim() || null;
      const getInput = (selector) => document.querySelector(selector)?.value?.trim() || null;
      const getSelectText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.options[el.selectedIndex]?.text?.trim() || null : null;
      };
      return {
        requester:          get('#Requester .ThemeGrid_Width8 span[data-expression]'),
        requesterDept:      get('#Department .ThemeGrid_Width8 span[data-expression]'),
        requesterMailgroup: getSelectText('#Dropdown_CREQ_REQ_MAILGROUP'),
        businessContact:    getInput('#Input_CREQ_BUSINESS_CONTACT'),
      };
    }

    function clickTabByText(text) {
      const tabs = document.querySelectorAll('button.osui-tabs__header-item');
      for (const tab of tabs) {
        if (tab.textContent.trim().includes(text)) {
          tab.click();
          return true;
        }
      }
      return false;
    }

    // Returns true only if the tab is found AND already marked active/selected.
    function isTabActive(text) {
      const tabs = document.querySelectorAll('button.osui-tabs__header-item');
      for (const tab of tabs) {
        if (tab.textContent.trim().includes(text)) {
          return tab.classList.contains('active') || tab.getAttribute('aria-selected') === 'true';
        }
      }
      return false;
    }

    // Avoids re-clicking a tab that's already active (which can retrigger
    // OutSystems' data binding/animation for no reason). Falls back to a
    // normal click if the tab isn't found at all, since isTabActive would
    // return false in that case too and clickTabByText will just no-op.
    function ensureTabActive(text) {
      if (!isTabActive(text)) {
        clickTabByText(text);
      } else {
        console.log(`[ASPortal] "${text}" tab already active, skipping click`);
      }
    }

    // ── Job Description scraping (per-call, indexed by the "_N-" prefix
    // found in the input id, e.g. "...-336_1-Input_CRTS_JOB_DESCR" → call 1) ──

    function parseJobDescriptions() {
      const inputs = document.querySelectorAll('input[id$="-Input_CRTS_JOB_DESCR"]');
      const map = {};
      let unindexedCount = 0;

      inputs.forEach((input) => {
        const m = input.id.match(/_(\d+)-Input_CRTS_JOB_DESCR$/);
        const value = input.value?.trim() || null;
        if (m) {
          map[parseInt(m[1], 10)] = value;
        } else {
          map[`__unindexed_${unindexedCount++}`] = value;
          console.warn('[ASPortal] Job Description field id did not match expected pattern:', input.id);
        }
      });

      return map;
    }

    // Merges scraped Job Description values into the Overview-parsed calls
    // array, matching on call index. Falls back to DOM order if no ids
    // parsed as numeric, and warns loudly on any count mismatch so it's
    // obvious in the console if not all calls were mounted in the DOM.
    function mergeJobDescriptions(calls, jobDescMap) {
      const numericKeys = Object.keys(jobDescMap)
        .filter(k => !k.startsWith('__unindexed_'))
        .map(Number);

      if (numericKeys.length > 0) {
        calls.forEach((call) => {
          if (call.call != null && jobDescMap[call.call] !== undefined) {
            call.jobDescription = jobDescMap[call.call];
          } else {
            call.jobDescription = null;
            console.warn('[ASPortal] No Job Description found for call', call.call, '— may need to expand that call before scraping');
          }
        });
        if (numericKeys.length !== calls.length) {
          console.warn(`[ASPortal] Found ${numericKeys.length} Job Description field(s) but ${calls.length} call(s) in Overview — likely only some calls are mounted/expanded in the DOM`);
        }
      } else {
        const values = Object.values(jobDescMap);
        console.warn('[ASPortal] Could not parse call index from any Job Description id — falling back to DOM order, verify this manually');
        calls.forEach((call, i) => { call.jobDescription = values[i] ?? null; });
      }

      return calls;
    }

    // ── Overview popup helpers ──

    function findOverviewButton() {
      const buttons = document.querySelectorAll('button.btn-primary');
      for (const b of buttons) {
        if (b.querySelector('i.fa-eye') && b.textContent.trim() === 'Overview') {
          return b;
        }
      }
      return null;
    }

    function getOpenPopup() {
      return document.querySelector('div[data-popup]');
    }

    function closePopup(popup) {
      const closeLink = popup?.querySelector('div[data-container] a[data-link]');
      if (closeLink) {
        closeLink.click();
      } else {
        console.warn('[ASPortal] Could not find popup close link');
      }
    }

    // Map of table header text -> field key.
    // Field keys reuse the existing per-call key names from the prior
    // form-scraping approach wherever an equivalent column exists; new
    // columns (not previously captured from the form) get new camelCase keys.
    const OVERVIEW_HEADER_MAP = {
      'Counter':                                              'call',
      'Business Division':                                    'businessDivision',
      'Plant Number':                                         'plantNumber',
      'SAP System ID':                                        'sapSystemSID',
      'SAP Client':                                           'sapClient',
      'Process Area':                                         'processArea',
      'SAP Module':                                           'module',
      'SAP Function Call':                                    'sapCallType',
      'SAP Object Name':                                      'sapProgram',
      'SAP Variant Name':                                     'variant',
      'SAP User Name':                                        'batchUser',
      'Enable Auto Restart':                                  'enableAutoRestart',
      'Number of Restarts':                                   'numberOfRestarts',
      'Restart Interval':                                     'restartInterval',
      'Failure Notification':                                 'failureNotification',
      'Solution Service':                                     'solutionService',
      'Email Recipient List':                                 'emailRecipientList',
      'Process Criticality':                                  'processCriticality',
      'Business Impact':                                      'businessImpact',
      'Criticality Description':                              'remarks',
      'Action In Case of Failure':                            'actionInCaseOfFailure',
      'Aggregation Level for Alerting':                       'aggregationLevelForAlerting',
      'SAP Language':                                         'language',
      'SAP Jobname':                                          'sapJobName',
      'Additional Information Start Date':                    'additionalInfoStartDate',
      'Additional Information Start Time':                    'additionalInfoStartTime',
      'Additional Information Holiday Region and Weekends':    'additionalInfoHolidayRegionAndWeekends',
      'Additional Information Dependency':                    'additionalInfoDependency',
      'Further Additional Information':                       'furtherAdditionalInformation',
    };

    function parseOverviewPopup(popup) {
      const table = popup.querySelector('table.table');
      if (!table) {
        console.warn('[ASPortal] Overview popup has no table');
        return [];
      }

      const headerCells = table.querySelectorAll('thead th');
      const keys = Array.from(headerCells).map((th) => {
        // Strip the trailing sort-icon div text, keep just the header label
        const label = th.childNodes[0]?.textContent?.trim() || th.textContent.trim();
        return OVERVIEW_HEADER_MAP[label] || label;
      });

      const rows = table.querySelectorAll('tbody tr.table-row');
      const calls = [];
      rows.forEach((row) => {
        const cells = row.querySelectorAll('td');
        const entry = {};
        cells.forEach((cell, i) => {
          const key = keys[i] || `col${i}`;
          const text = cell.querySelector('span[data-expression]')?.textContent?.trim() ?? cell.textContent.trim();
          entry[key] = text === '' ? null : text;
        });
        // Counter comes through as a string from the DOM; normalize to number for 'call'
        if (entry.call != null && /^\d+$/.test(entry.call)) {
          entry.call = parseInt(entry.call, 10);
        }
        calls.push(entry);
      });
      return calls;
    }

    function openOverviewAndParse(callback) {
      const overviewBtn = findOverviewButton();
      if (!overviewBtn) {
        console.warn('[ASPortal] Overview button not found');
        callback([]);
        return;
      }

      console.log('[ASPortal] Clicking Overview...');
      overviewBtn.click();

      waitFor(
        () => {
          const popup = getOpenPopup();
          if (!popup) return false;
          const rows = popup.querySelectorAll('table.table tbody tr.table-row');
          return rows.length > 0;
        },
        () => {
          const popup = getOpenPopup();
          const calls = popup ? parseOverviewPopup(popup) : [];
          console.log('[ASPortal] Overview parsed:', calls);

          if (popup) {
            closePopup(popup);
          }

          callback(calls);
        }
      );
    }

    // ── Scheduling tab scraping (Execution End Date) ──
    // The date input is disabled/decorative (flatpickr renders a second,
    // readonly text input on top of it for display), so we read the value
    // straight off the underlying `type="date"` input rather than trying
    // to interact with the flatpickr UI.

    function parseSchedulingInfo() {
      const dateInput = document.querySelector('input[id$="-Input_EndDate"]');
      return {
        lifecycleExpiring: dateInput?.value?.trim() || null
      };
    }

    let isProcessing = false;

    // Command handling is now event-driven via GM_addValueChangeListener
    // instead of a 500ms poll. This avoids background-tab throttling —
    // the listener fires promptly on the storage write regardless of
    // whether this tab currently has focus.
    function handleCommand(cmd) {
      const myRequestId = getCurrentRequestId();
      if (cmd.requestId !== myRequestId) return;
      if (isProcessing) return;
      if (cmd.action !== 'click_and_parse') return;
      isProcessing = true;

      console.log('[ASPortal] Ensuring Request Information tab...');
      ensureTabActive('Request Information');

      waitFor(
        () => !!document.querySelector('#Input_CREQ_BUSINESS_CONTACT'),
        () => {
          const requestInfo = parseRequestInfo();
          console.log('[ASPortal] Request Info parsed:', requestInfo);

          console.log('[ASPortal] Ensuring Build Information tab...');
          ensureTabActive('Build Information');

          waitFor(
            () => !!document.querySelector('input[id$="-Input_CRTS_JOB_DESCR"]') && !!findOverviewButton(),
            () => {
              const jobDescMap = parseJobDescriptions();
              console.log('[ASPortal] Job Descriptions parsed:', jobDescMap);

              openOverviewAndParse((calls) => {
                const mergedCalls = mergeJobDescriptions(calls, jobDescMap);

                console.log('[ASPortal] Ensuring Scheduling tab...');
                ensureTabActive('Scheduling');

                waitFor(
                  () => !!document.querySelector('input[id$="-Input_EndDate"]'),
                  () => {
                    const schedulingInfo = parseSchedulingInfo();
                    console.log('[ASPortal] Scheduling Info parsed:', schedulingInfo);

                    GM_setValue('asportal_result', JSON.stringify({
                      ts: Date.now(),
                      data: {
                        requestId: myRequestId,
                        requestInfo,
                        schedulingInfo,
                        calls: mergedCalls
                      }
                    }));
                    isProcessing = false;
                  }
                );
              });
            }
          );
        }
      );
    }

    GM_addValueChangeListener('asportal_command', (name, oldValue, newValue, remote) => {
      if (!newValue) return;
      const cmd = JSON.parse(newValue);
      // Consume the command immediately so a page reload / userscript
      // re-init can't re-trigger this same command again.
      GM_setValue('asportal_command', '');
      handleCommand(cmd);
    });

    // Heartbeat is scoped per Request ID so RMJ can see *every* open
    // ASPortal tab at once (not just the most recently active one).
    // ASPortal side — write a heartbeat immediately at script init, not just on the first interval tick
    setInterval(() => {
      const reqId = getCurrentRequestId();
      if (!reqId) return;
      GM_setValue('asportal_heartbeat_' + reqId, JSON.stringify({
        ts: Date.now(),
        requestId: reqId,
        title: document.title || null
      }));
    }, 3000);

    (function heartbeatNow() {
      const reqId = getCurrentRequestId();
      if (reqId) {
        GM_setValue('asportal_heartbeat_' + reqId, JSON.stringify({
          ts: Date.now(),
          requestId: reqId,
          title: document.title || null
        }));
      }
    })();

    // Clean up this tab's heartbeat when it closes/navigates away so it
    // doesn't linger as a stale suggestion on the RMJ side.
    window.addEventListener('beforeunload', () => {
      const reqId = getCurrentRequestId();
      if (reqId) GM_deleteValue('asportal_heartbeat_' + reqId);
    });

    console.log('[ASPortal] Polling for heartbeat, listening for commands... RequestId:', getCurrentRequestId());
  }

})();
