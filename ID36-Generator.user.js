// ==UserScript==
// @name         APEX: ID36 Generator
// @namespace    bosch-asportal
// @version      1.1
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

  // === CLIPBOARD: copy with focus-aware retry ===
  // Waits for the window to be focused before attempting clipboard write,
  // so switching tabs during generation doesn't cause the copy to fail.
  const copyToClipboard = (text) => new Promise((resolve) => {
    const attempt = () => {
      navigator.clipboard.writeText(text).then(resolve).catch(() => {
        // Fallback: textarea execCommand (works regardless of focus)
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        } catch (_) {}
        resolve();
      });
    };

    if (document.hasFocus()) {
      attempt();
    } else {
      // Window is not focused — wait until it regains focus, then copy
      const onFocus = () => {
        window.removeEventListener('focus', onFocus);
        attempt();
      };
      window.addEventListener('focus', onFocus);
    }
  });

  // === CUSTOM MODAL: replaces alert(), shows all IDs, has Copy button ===
  const showResultModal = (results, alreadyCopied) => {
    // Remove any existing modal
    const existing = document.getElementById('id36-modal-overlay');
    if (existing) existing.remove();

    const text = results.join('\n');

    const overlay = document.createElement('div');
    overlay.id = 'id36-modal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #fff; border-radius: 10px; padding: 24px 28px;
      min-width: 340px; max-width: 520px; width: 90vw;
      box-shadow: 0 8px 32px rgba(0,0,0,0.22);
      display: flex; flex-direction: column; gap: 16px;
      color: #1a1a1a;
    `;

    const title = document.createElement('div');
    title.style.cssText = 'font-size: 16px; font-weight: 600;';
    title.textContent = `${results.length} ID${results.length !== 1 ? 's' : ''} generated`;

    const statusBadge = document.createElement('div');
    statusBadge.id = 'id36-copy-status';
    statusBadge.style.cssText = `
      font-size: 13px; padding: 4px 10px; border-radius: 5px; display: inline-block;
      background: ${alreadyCopied ? '#e6f4ea' : '#fff3cd'};
      color: ${alreadyCopied ? '#2d6a4f' : '#856404'};
      border: 1px solid ${alreadyCopied ? '#b7dfca' : '#ffc107'};
    `;
    statusBadge.textContent = alreadyCopied ? '✓ Copied to clipboard' : '⚠ Click "Copy" to copy';

    const textarea = document.createElement('textarea');
    textarea.readOnly = true;
    textarea.value = text;
    textarea.style.cssText = `
      width: 100%; box-sizing: border-box;
      min-height: ${Math.min(results.length * 28 + 16, 300)}px;
      max-height: 50vh;
      font-family: monospace; font-size: 13px; line-height: 1.6;
      border: 1px solid #ccc; border-radius: 6px;
      padding: 10px; resize: vertical; color: #1a1a1a;
      background: #f8f8f8;
    `;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copy all';
    copyBtn.style.cssText = `
      padding: 8px 18px; border-radius: 6px; border: none; cursor: pointer;
      background: #0066cc; color: #fff; font-size: 14px; font-weight: 500;
    `;
    copyBtn.onclick = () => {
      copyToClipboard(text).then(() => {
        copyBtn.textContent = '✓ Copied!';
        copyBtn.style.background = '#2d6a4f';
        const badge = document.getElementById('id36-copy-status');
        if (badge) {
          badge.textContent = '✓ Copied to clipboard';
          badge.style.background = '#e6f4ea';
          badge.style.color = '#2d6a4f';
          badge.style.border = '1px solid #b7dfca';
        }
        setTimeout(() => {
          copyBtn.textContent = '📋 Copy all';
          copyBtn.style.background = '#0066cc';
        }, 2000);
      });
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
      padding: 8px 18px; border-radius: 6px; cursor: pointer;
      background: #f0f0f0; color: #333; font-size: 14px;
      border: 1px solid #ccc; font-weight: 500;
    `;
    closeBtn.onclick = () => overlay.remove();

    // Close on overlay background click
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    btnRow.appendChild(copyBtn);
    btnRow.appendChild(closeBtn);

    modal.appendChild(title);
    modal.appendChild(statusBadge);
    modal.appendChild(textarea);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Select all text in textarea for easy manual copy if needed
    textarea.focus();
    textarea.select();
  };

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

      // === Copy to clipboard (focus-aware) ===
      const text = results.join('\n');
      let copied = false;
      if (document.hasFocus()) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch {
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            copied = true;
          } catch (_) {}
        }
      }
      // If window not focused, the modal Copy button will handle it

      // === Show custom modal (replaces alert) ===
      showResultModal(results, copied);

      // If not yet copied, set up focus listener to auto-copy when user returns
      if (!copied) {
        const onFocus = () => {
          window.removeEventListener('focus', onFocus);
          navigator.clipboard.writeText(text).then(() => {
            const badge = document.getElementById('id36-copy-status');
            if (badge) {
              badge.textContent = '✓ Auto-copied when you returned to tab';
              badge.style.background = '#e6f4ea';
              badge.style.color = '#2d6a4f';
              badge.style.border = '1px solid #b7dfca';
            }
          }).catch(() => {});
        };
        window.addEventListener('focus', onFocus);
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
