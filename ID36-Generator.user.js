// ==UserScript==
// @name         APEX: ID36 Generator
// @namespace    bosch-asportal
// @version      1.0
// @description  Generates and copies multiple ID36 values from APEX by replaying the backend request
// @author       You
// @match        https://rb-wam.bosch.com/rb-aeinfoapp/ords/f?p=100:3035*
// @grant        none
// @run-at       document-start
// ==/UserScript==

// NOTE: This script requires Tampermonkey's "Inject into page" / document-start execution.
// In Tampermonkey settings for this script, set "Run at" to "document-start".
// The script intercepts fetch/XHR before the page scripts load, which is why it must run early.

(() => {
  'use strict';

  const BUTTON_ID = 'B104644304689682124';
  const DEFAULT_NUM_REQUESTS = 1;
  const DELAY_MS = 300;
  const CAPTURE_KEY = '___ID36_CAPTURED___';

  // === 1. SETUP INTERCEPTORS ===
  let capturedRequest = null;
  window[CAPTURE_KEY] = null;

  // Intercept fetch
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input?.url;
    if (url && url.includes('wwv_flow.ajax')) {
      capturedRequest = {
        type: 'fetch',
        input,
        init: init ? { ...init, headers: { ...init.headers } } : {}
      };
      window[CAPTURE_KEY] = capturedRequest;
    }
    return origFetch.apply(this, args);
  };

  // Intercept XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._method = method;
    this._url = url;
    this._headers = {};
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    this._headers[name] = value;
    return origSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (this._url && this._url.includes('wwv_flow.ajax')) {
      capturedRequest = {
        type: 'xhr',
        url: this._url,
        method: this._method,
        headers: { ...this._headers },
        body: body
      };
      window[CAPTURE_KEY] = capturedRequest;
    }
    return origSend.apply(this, arguments);
  };

  // === 2. Wait for button ===
  const waitForButton = () => new Promise(resolve => {
    const check = () => {
      const btn = document.getElementById(BUTTON_ID);
      if (btn) resolve(btn);
      else setTimeout(check, 100);
    };
    check();
  });

  waitForButton().then(button => {
    const td = button.closest('td');
    if (!td) {
      console.error('[ID36] Button has no <td> parent');
      return;
    }

    // === Create input box ===
    const inputBox = document.createElement('input');
    Object.assign(inputBox, {
      type: 'number',
      min: 1,
      max: 100,
      value: DEFAULT_NUM_REQUESTS,
      title: 'Number of IDs to generate & copy'
    });
    inputBox.style.cssText = `
      width: 50px; margin-left: 8px; padding: 4px; font-size: 13px;
      border: 1px solid #ccc; border-radius: 4px; vertical-align: middle;
    `;
    button.after(inputBox);

    console.log('%c[ID36] Ready! Enter count → click button → IDs copied', 'color: #4CAF50; font-weight: bold;');

    // === Click handler ===
    button.addEventListener('click', async () => {
      const totalWanted = Math.max(1, parseInt(inputBox.value, 10) || 1);
      await new Promise(r => setTimeout(r, 150));

      let originalId = '';
      let attempts = 0;

      while (attempts < 60) {
        const elem = document.getElementById('P3035_ID36');
        originalId = elem?.value?.trim() || '';
        if (capturedRequest && originalId) break;
        await new Promise(r => setTimeout(r, 50));
        attempts++;
      }

      if (!capturedRequest || !originalId) {
        alert('Failed to capture request or ID. Try again.');
        inputBox.value = DEFAULT_NUM_REQUESTS;
        return;
      }

      const results = [originalId];
      console.log(`[+] Original: ${originalId}`);

      const extraNeeded = totalWanted - 1;
      for (let i = 0; i < extraNeeded; i++) {
        try {
          let res;
          if (capturedRequest.type === 'fetch') {
            const { input, init } = capturedRequest;
            res = await fetch(input, {
              ...init,
              credentials: 'include',
              headers: {
                ...(init.headers || {}),
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
              }
            });
          } else {
            const { url, method, headers, body } = capturedRequest;
            res = await fetch(url, {
              method,
              headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
              },
              body,
              credentials: 'include'
            });
          }

          const json = await res.json();
          const value = json.item?.find?.(it => it.id === 'P3035_ID36')?.value || 'ERROR';
          results.push(value);
          console.log(`[+] Extra #${i + 1}: ${value}`);
        } catch (err) {
          console.error('Extra request failed:', err);
          results.push('ERROR');
        }

        if (i < extraNeeded - 1) {
          await new Promise(r => setTimeout(r, DELAY_MS));
        }
      }

      // === Copy to clipboard ===
      const text = results.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        alert(`Copied ${results.length} ID(s):\n\n${text}`);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert(`Copied (fallback):\n\n${text}`);
      }

      // === Update field with last valid ID ===
      const lastId = results[results.length - 1];
      const targetField = document.getElementById('P3035_ID36');
      if (targetField && lastId && lastId !== 'ERROR') {
        targetField.value = lastId;
        targetField.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`[ID36] Field updated → ${lastId}`);
      }

      inputBox.value = DEFAULT_NUM_REQUESTS;
      capturedRequest = null;
      window[CAPTURE_KEY] = null;
    });
  });
})();
