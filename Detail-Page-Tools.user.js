// ==UserScript==
// @name         AS-Portal: Tools + AWI Link
// @namespace    bosch-asportal
// @version      2.6
// @description  Build Info copy button + AWI links + Auto Expandable Description + Automation Object copy button
// @author       Minh Dinh
// @match        https://apps-p-p1-outsystems.de.bosch.com/ASPortal/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const REQ_BLOCK_SEL =
    'div[data-block="MainFlow.REQ_CreatedObjects"], div[data-block="REQUEST.REQ_CreatedObjects"]';

  async function copyToClipboard(text, successMsg) {
    try {
      await navigator.clipboard.writeText(text);
      alert(successMsg);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        alert(successMsg + " (fallback)");
      } catch (_) {
        alert(`Copy failed:\n${text}`);
      } finally {
        ta.remove();
      }
    }
  }

  /* ============================================================= */
  /* Expand Description Box                                        */
  /* ============================================================= */
  function applyExpandableDescription() {
    const textarea = document.getElementById("TextArea_CREQ_DESCR");
    if (!textarea || document.getElementById("descr-expand-bar")) return;

    textarea.style.resize = "vertical";
    textarea.style.minHeight = "120px";
    textarea.style.maxHeight = "700px";
    textarea.style.overflow = "auto";
    textarea.style.transition = "height 0.25s ease";
    textarea.style.cursor = "ns-resize";

    const collapsedHeight = textarea.offsetHeight + "px";

    const bar = document.createElement("div");
    bar.id = "descr-expand-bar";
    bar.style.cssText =
      "display:flex;align-items:center;gap:6px;margin-top:4px;";

    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = "⛶ Expand";
    toggleBtn.style.cssText =
      "padding:3px 10px;font-size:12px;cursor:pointer;border:1px solid #aaa;border-radius:4px;background:#f5f5f5;";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "80";
    slider.max = "700";
    slider.value = textarea.offsetHeight;
    slider.title = "Drag to resize";
    slider.style.cssText = "width:120px;cursor:pointer;";

    const sizeLabel = document.createElement("span");
    sizeLabel.style.cssText = "font-size:11px;color:#666;";
    sizeLabel.textContent = `${textarea.offsetHeight}px`;

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "📋 Copy text";
    copyBtn.style.cssText =
      "padding:3px 10px;font-size:12px;cursor:pointer;border:1px solid #aaa;border-radius:4px;background:#f5f5f5;margin-left:auto;";

    bar.append(toggleBtn, slider, sizeLabel, copyBtn);
    textarea.parentNode.insertBefore(bar, textarea.nextSibling);

    let expanded = false;
    toggleBtn.addEventListener("click", () => {
      expanded = !expanded;
      const h = expanded ? "400px" : collapsedHeight;
      textarea.style.height = h;
      slider.value = parseInt(h);
      sizeLabel.textContent = h;
      toggleBtn.textContent = expanded ? "⊖ Collapse" : "⛶ Expand";
    });

    slider.addEventListener("input", () => {
      const h = slider.value + "px";
      textarea.style.height = h;
      sizeLabel.textContent = h;
      expanded = parseInt(slider.value) > parseInt(collapsedHeight);
      toggleBtn.textContent = expanded ? "⊖ Collapse" : "⛶ Expand";
    });

    copyBtn.addEventListener("click", async () => {
      const text = textarea.value || textarea.textContent || "";
      if (!text.trim()) return alert("Description box is empty.");
      await copyToClipboard(text.trim(), "Description text copied!");
    });

    textarea.addEventListener("mouseenter", () => {
      if (!expanded) {
        textarea.style.height = "320px";
        slider.value = 320;
        sizeLabel.textContent = "320px";
      }
    });
    textarea.addEventListener("mouseleave", () => {
      if (!expanded) {
        textarea.style.height = collapsedHeight;
        slider.value = parseInt(collapsedHeight);
        sizeLabel.textContent = collapsedHeight;
      }
    });
  }

  function waitForDescriptionAndExpand() {
    if (document.getElementById("TextArea_CREQ_DESCR")) {
      applyExpandableDescription();
      return;
    }
    const obs = new MutationObserver(() => {
      if (document.getElementById("TextArea_CREQ_DESCR")) {
        obs.disconnect();
        applyExpandableDescription();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener("OSAjaxFinished", () =>
    setTimeout(applyExpandableDescription, 600),
  );

  /* ============================================================= */
  /* Automation Object column copy button                          */
  /* ============================================================= */
  function addAutomationObjectCopyButton(block) {
    const table = block.querySelector("table");
    if (!table) return;
    const thead = table.querySelector("thead tr");
    if (!thead) return;

    const headers = Array.from(thead.querySelectorAll("th"));
    const autoObjTh = headers.find(
      (th) => th.innerText.trim() === "Automation Object",
    );
    if (!autoObjTh || autoObjTh.dataset.copyBtnAdded) return;

    const btn = document.createElement("button");
    btn.textContent = "📋";
    btn.title = "Copy all Automation Object names";
    btn.style.cssText =
      "margin-left:6px;padding:1px 5px;font-size:11px;cursor:pointer;" +
      "border:1px solid #aaa;border-radius:3px;background:#f0f0f0;vertical-align:middle;";

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const colIdx = headers.indexOf(autoObjTh);
      const lines = [];
      table.querySelectorAll("tbody tr").forEach((row) => {
        const cell = row.querySelectorAll("td")[colIdx];
        const val = cell?.innerText.trim();
        if (val) lines.push(val);
      });
      if (!lines.length) return alert("No automation objects found.");
      await copyToClipboard(
        lines.join("\n"),
        `Copied ${lines.length} object(s)!`,
      );
    });

    autoObjTh.appendChild(btn);
    autoObjTh.dataset.copyBtnAdded = "1";
  }

  /* ============================================================= */
  /* Build Info tab copy button                                    */
  /* ============================================================= */
  function collectBuildInfoRows(content) {
    const rows = [];

    // UPDATE path: anchored on -JobName containers (only present in UPDATE)
    const jobNameContainers = content.querySelectorAll('[id$="-JobName"]');
    if (jobNameContainers.length > 0) {
      jobNameContainers.forEach((container) => {
        const nameSpan = container.querySelector("span[data-expression]");
        const jobName = nameSpan ? nameSpan.textContent.trim() : "";
        if (!jobName) return;

        const prefix = container.id.replace(/-JobName$/, "");
        const updateNewVal = document.getElementById(
          `${prefix}-Input_CRTS_MANDT`,
        );
        if (updateNewVal) {
          const newVal = (
            updateNewVal.value ||
            updateNewVal.getAttribute("value") ||
            ""
          ).trim();
          rows.push(`${jobName}\t${newVal}`);
        }
      });
      return rows;
    }

    // CREATE path: no -JobName containers; find all OBJNAME2 inputs directly
    content
      .querySelectorAll('[id$="-Input_CRTS_OBJNAME2"]')
      .forEach((programEl) => {
        const prog = (
          programEl.value ||
          programEl.getAttribute("value") ||
          ""
        ).trim();
        if (!prog) return;

        // Derive sibling variant input: same prefix, different suffix
        const prefix = programEl.id.replace(/-Input_CRTS_OBJNAME2$/, "");
        const varEl = document.getElementById(`${prefix}-Input_CRTS_VARIANT2`);
        const variant = varEl
          ? (varEl.value || varEl.getAttribute("value") || "").trim()
          : "";
        rows.push(`${prog}\t${variant}`);
      });

    return rows;
  }

  function addBuildInfoCopyButton() {
    const buildRunContent = document.getElementById("BuildRunContent");
    if (!buildRunContent || buildRunContent.dataset.copyBtnAdded) return;

    const btn = document.createElement("button");
    btn.textContent = "📋 Copy Build Info";
    btn.title =
      "CREATE: SAP Program + Variant per call | UPDATE: Job Name + New Value per call";
    btn.style.cssText =
      "margin:8px 10px 0;padding:4px 12px;font-size:12px;cursor:pointer;" +
      "border:1px solid #aaa;border-radius:4px;background:#f0f0f0;display:block;";

    btn.addEventListener("click", async () => {
      const rows = collectBuildInfoRows(buildRunContent);
      if (!rows.length) return alert("No entries found in Build Information.");
      await copyToClipboard(rows.join("\n"), `Copied ${rows.length} row(s)!`);
    });

    buildRunContent.insertBefore(btn, buildRunContent.firstChild);
    buildRunContent.dataset.copyBtnAdded = "1";
    console.log("[+] Build Info copy button added");
  }

  /* ============================================================= */
  /* AWI Links                                                     */
  /* ============================================================= */
  function addAwiLinks() {
    document.querySelectorAll('[id$="-JobName"]').forEach((container) => {
      if (container.dataset.awiLinkAdded) return;

      const prefix = container.id.replace(/-JobName$/, "");
      const serverEl = document.querySelector(
        `#${prefix}-SchedServer span[data-expression]`,
      );
      const clientEl = document.querySelector(
        `#${prefix}-SchedClient span[data-expression]`,
      );
      const nameEl = container.querySelector("span[data-expression]");

      if (!serverEl || !clientEl || !nameEl) return;

      const server = serverEl.textContent.trim().toLowerCase();
      const client = clientEl.textContent.trim();
      const jobName = nameEl.textContent.trim();
      if (!server || !client || !jobName) return;

      const link = document.createElement("a");
      link.href = `https://rb-${server}.bosch.com/awi/${server.toUpperCase()}/${client}@pa/view/${jobName}`;
      link.target = "_blank";
      link.rel = "noopener";
      link.title = "Open in AWI";
      link.style.cssText =
        "margin-left:12px;font-size:14px;font-weight:bold;color:#19699b !important;text-decoration:underline;";
      link.textContent = "AWI";

      const valueContainer =
        container.querySelector(".OSInline:nth-child(2)") ||
        container.querySelector("div.OSInline + div") ||
        container.lastElementChild;

      if (valueContainer) {
        valueContainer.appendChild(document.createTextNode(" "));
        valueContainer.appendChild(link);
        container.dataset.awiLinkAdded = "true";
      }
    });
  }

  /* ============================================================= */
  /* Wait for REQ_CreatedObjects block                             */
  /* ============================================================= */
  function waitForReqBlock() {
    return new Promise((res) => {
      const existing = document.querySelector(REQ_BLOCK_SEL);
      if (existing) return res(existing);
      const obs = new MutationObserver(() => {
        const block = document.querySelector(REQ_BLOCK_SEL);
        if (block) {
          obs.disconnect();
          res(block);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  /* ============================================================= */
  /* Initialize                                                    */
  /* ============================================================= */
  addAwiLinks();
  waitForDescriptionAndExpand();

  setTimeout(addBuildInfoCopyButton, 800);
  document.addEventListener("OSAjaxFinished", () => {
    setTimeout(() => {
      const brc = document.getElementById("BuildRunContent");
      if (brc) delete brc.dataset.copyBtnAdded;
      addBuildInfoCopyButton();
    }, 700);
  });

  const awiObs = new MutationObserver(() => setTimeout(addAwiLinks, 300));
  awiObs.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("OSAjaxFinished", () =>
    setTimeout(addAwiLinks, 400),
  );

  waitForReqBlock().then((block) => addAutomationObjectCopyButton(block));
  document.addEventListener("OSAjaxFinished", () => {
    setTimeout(() => {
      const block = document.querySelector(REQ_BLOCK_SEL);
      if (block) addAutomationObjectCopyButton(block);
    }, 700);
  });

  console.log("AS-Portal Tools + AWI Link v2.6 loaded");
})();
