// ==UserScript==
// @name         AS-Portal: Tools + AWI Link
// @namespace    bosch-asportal
// @version      2.3
// @description  Hamburger tools + direct AWI links + TEMP_DEACTIVATE + Auto Expandable Description
// @author       You
// @match        https://apps-p-p1-outsystems.de.bosch.com/ASPortal/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  /* ============================================================= */
  /* SHARED: Expand Description Box (called automatically)         */
  /* ============================================================= */
  function applyExpandableDescription() {
    const textarea = document.getElementById("TextArea_CREQ_DESCR");
    if (!textarea || document.getElementById("descr-expand-bar")) return;

    /* -- Make it visually resizable even while disabled -- */
    textarea.style.resize = "vertical";
    textarea.style.minHeight = "120px";
    textarea.style.maxHeight = "700px";
    textarea.style.overflow = "auto";
    textarea.style.transition = "height 0.25s ease";
    textarea.style.cursor = "ns-resize";

    const collapsedHeight = textarea.offsetHeight + "px";

    /* -- Toolbar bar sitting just below the textarea -- */
    const bar = document.createElement("div");
    bar.id = "descr-expand-bar";
    bar.style.cssText =
      "display:flex;align-items:center;gap:6px;margin-top:4px;";

    /* Expand / Collapse button */
    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = "⛶ Expand";
    toggleBtn.style.cssText = `
      padding: 3px 10px; font-size: 12px; cursor: pointer;
      border: 1px solid #aaa; border-radius: 4px; background: #f5f5f5;
    `;

    /* Height slider */
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "80";
    slider.max = "700";
    slider.value = textarea.offsetHeight;
    slider.title = "Drag to resize";
    slider.style.cssText = "width:120px; cursor:pointer;";

    /* Height label */
    const sizeLabel = document.createElement("span");
    sizeLabel.style.cssText = "font-size:11px; color:#666;";
    sizeLabel.textContent = `${textarea.offsetHeight}px`;

    /* Copy button */
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "📋 Copy text";
    copyBtn.style.cssText = `
      padding: 3px 10px; font-size: 12px; cursor: pointer;
      border: 1px solid #aaa; border-radius: 4px; background: #f5f5f5;
      margin-left: auto;
    `;

    bar.appendChild(toggleBtn);
    bar.appendChild(slider);
    bar.appendChild(sizeLabel);
    bar.appendChild(copyBtn);

    textarea.parentNode.insertBefore(bar, textarea.nextSibling);

    /* -- Toggle expand / collapse -- */
    let expanded = false;
    toggleBtn.addEventListener("click", () => {
      expanded = !expanded;
      if (expanded) {
        textarea.style.height = "400px";
        slider.value = 400;
        sizeLabel.textContent = "400px";
        toggleBtn.textContent = "⊖ Collapse";
      } else {
        textarea.style.height = collapsedHeight;
        slider.value = parseInt(collapsedHeight);
        sizeLabel.textContent = collapsedHeight;
        toggleBtn.textContent = "⛶ Expand";
      }
    });

    /* -- Slider resize -- */
    slider.addEventListener("input", () => {
      const h = slider.value + "px";
      textarea.style.height = h;
      sizeLabel.textContent = h;
      expanded = parseInt(slider.value) > parseInt(collapsedHeight);
      toggleBtn.textContent = expanded ? "⊖ Collapse" : "⛶ Expand";
    });

    /* -- Copy text content -- */
    copyBtn.addEventListener("click", async () => {
      const text = textarea.value || textarea.textContent || "";
      if (!text.trim()) return alert("Description box is empty.");
      await copyToClipboard(text.trim(), "Description text copied!");
    });

    /* -- Hover peek -- */
    textarea.addEventListener("mouseenter", () => {
      if (!expanded) {
        textarea.style.height = "220px";
        slider.value = 220;
        sizeLabel.textContent = "220px";
      }
    });
    textarea.addEventListener("mouseleave", () => {
      if (!expanded) {
        textarea.style.height = collapsedHeight;
        slider.value = parseInt(collapsedHeight);
        sizeLabel.textContent = collapsedHeight;
      }
    });

    console.log("[+] Description box expanded automatically");
  }

  /* Watch for the textarea to appear (it may load after DOM ready) */
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

  /* Re-apply after any AJAX navigation (OutSystems SPA behaviour) */
  document.addEventListener("OSAjaxFinished", () => {
    setTimeout(applyExpandableDescription, 600);
  });

  /* ============================================================= */
  /* 1. Hamburger Menu with ALL original copy tools                */
  /* ============================================================= */
  function addHamburgerToToolbar() {
    if (document.getElementById("obj-hamburger")) return;

    const actionsDiv = document.getElementById("Actions");
    if (!actionsDiv) {
      console.warn("[!] #Actions toolbar not found – retrying...");
      return setTimeout(addHamburgerToToolbar, 500);
    }

    const refreshBtn = document.getElementById("RefreshRequestButton");
    if (!refreshBtn) {
      console.warn("[!] Refresh button not found – retrying...");
      return setTimeout(addHamburgerToToolbar, 500);
    }

    const hamContainer = document.createElement("div");
    hamContainer.className = "OSInline";
    hamContainer.style.cssText =
      "text-align: center; width: 60px; height: 50px; margin-top: 15px;";

    const hamLink = document.createElement("a");
    hamLink.href = "#";
    hamLink.className = "lightItem";
    hamLink.style.textDecoration = "none";
    hamLink.id = "obj-hamburger";

    const iconDiv = document.createElement("div");
    iconDiv.innerHTML =
      '<i class="icon fa fa-lightbulb-o fa-2x" style="color: rgb(34, 34, 34); font-size: 25px;"></i>';

    const labelDiv = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = "Tools";
    label.style.cssText = "color: rgb(34, 34, 34); font-size: 12px;";
    labelDiv.appendChild(label);

    hamLink.appendChild(iconDiv);
    hamLink.appendChild(labelDiv);
    hamContainer.appendChild(hamLink);
    actionsDiv.insertBefore(hamContainer, refreshBtn.parentNode.nextSibling);

    const panel = document.createElement("div");
    panel.id = "obj-panel";
    Object.assign(panel.style, {
      position: "absolute",
      background: "#fff",
      border: "1px solid #ccc",
      borderRadius: "6px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      padding: "8px 0",
      minWidth: "210px",
      display: "none",
      zIndex: "9999",
    });
    hamContainer.appendChild(panel);

    const addItem = (emoji, text, cb) => {
      const b = document.createElement("button");
      b.style.cssText =
        "display:flex;align-items:center;width:100%;padding:8px 16px;text-align:left;background:none;border:none;cursor:pointer;font-size:14px;";
      b.innerHTML = `<span style="margin-right:8px;font-size:16px;">${emoji}</span><span>${text}</span>`;
      b.onmouseenter = () => (b.style.background = "#f0f0f0");
      b.onmouseleave = () => (b.style.background = "none");
      b.onclick = async (e) => {
        e.stopPropagation();
        panel.style.display = "none";
        await cb();
      };
      panel.appendChild(b);
    };

    /* ---- Copy All Objects + Job Names ---- */
    addItem("📋", "Copy Objects + Job Names", async () => {
      const table = document.querySelector(
        'div[data-block="MainFlow.REQ_CreatedObjects"] table',
      );
      if (!table) return alert("Objects table not found.");
      const rows = table.querySelectorAll("tbody tr");
      const lines = [];
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 3) {
          const obj = cells[2].innerText.trim();
          if (obj) lines.push(obj);
        }
      });
      if (!lines.length) return alert("No object names found.");
      await copyToClipboard(lines.join("\n"), `Copied ${lines.length} object(s)!`);
    });

    /* ---- Copy Job Names only ---- */
    addItem("📄", "Copy Job Names Only", async () => {
      const table = document.querySelector(
        'div[data-block="MainFlow.REQ_CreatedObjects"] table',
      );
      if (!table) return alert("Objects table not found.");
      const rows = table.querySelectorAll("tbody tr");
      const lines = [];
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 3) {
          const obj = cells[2].innerText.trim();
          const type = cells[5]?.innerText.trim();
          if (obj && type !== "JOBP") lines.push(obj);
        }
      });
      if (!lines.length) return alert("No job names found.");
      await copyToClipboard(lines.join("\n"), `Copied ${lines.length} job(s)!`);
    });

    /* ---- Copy JOBP names only ---- */
    addItem("📁", "Copy JOBP Names Only", async () => {
      const table = document.querySelector(
        'div[data-block="MainFlow.REQ_CreatedObjects"] table',
      );
      if (!table) return alert("Objects table not found.");
      const rows = table.querySelectorAll("tbody tr");
      const lines = [];
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 6) {
          const obj = cells[2].innerText.trim();
          const type = cells[5].innerText.trim();
          if (obj && type === "JOBP") lines.push(obj);
        }
      });
      if (!lines.length) return alert("No JOBP objects found.");
      await copyToClipboard(lines.join("\n"), `Copied ${lines.length} JOBP(s)!`);
    });

    /* ---- Copy as Table (TSV) ---- */
    addItem("📊", "Copy Table as TSV", async () => {
      const table = document.querySelector(
        'div[data-block="MainFlow.REQ_CreatedObjects"] table',
      );
      if (!table) return alert("Objects table not found.");
      const rows = Array.from(table.querySelectorAll("tr"));
      const lines = rows.map((row) =>
        Array.from(row.querySelectorAll("th, td"))
          .map((c) => c.innerText.trim())
          .join("\t"),
      );
      await copyToClipboard(lines.join("\n"), "Table copied as TSV!");
    });

    /* ---- Separator ---- */
    const sep = document.createElement("hr");
    sep.style.cssText = "margin: 4px 0; border: none; border-top: 1px solid #eee;";
    panel.appendChild(sep);

    /* ---- Show Column Picker ---- */
    addItem("🔧", "Select Columns to Copy…", () => {
      if (document.getElementById("col-picker-panel")) return;

      const table = document.querySelector(
        'div[data-block="MainFlow.REQ_CreatedObjects"] table',
      );
      if (!table) return alert("Objects table not found.");

      const headers = Array.from(table.querySelectorAll("thead th")).map(
        (th) => th.innerText.trim(),
      );

      const colPanel = document.createElement("div");
      colPanel.id = "col-picker-panel";
      Object.assign(colPanel.style, {
        position: "fixed",
        top: "120px",
        right: "30px",
        background: "#fff",
        border: "1px solid #ccc",
        borderRadius: "8px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
        padding: "16px",
        zIndex: "10000",
        minWidth: "220px",
        fontFamily: "sans-serif",
        fontSize: "13px",
      });

      const title = document.createElement("strong");
      title.textContent = "Select columns to copy:";
      colPanel.appendChild(title);
      colPanel.appendChild(document.createElement("br"));
      colPanel.appendChild(document.createElement("br"));

      const checks = headers.map((h, i) => {
        const label = document.createElement("label");
        label.style.cssText = "display:block; margin-bottom:6px; cursor:pointer;";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.dataset.idx = i;
        cb.style.marginRight = "6px";
        label.appendChild(cb);
        label.appendChild(document.createTextNode(h || `Col ${i + 1}`));
        colPanel.appendChild(label);
        return cb;
      });

      const copyColBtn = document.createElement("button");
      copyColBtn.textContent = "📋 Copy selected";
      copyColBtn.style.cssText =
        "margin-top:12px;background:#19699b;color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;";
      copyColBtn.onclick = async () => {
        const selectedIdxs = checks
          .filter((c) => c.checked)
          .map((c) => parseInt(c.dataset.idx));
        if (!selectedIdxs.length) return alert("Select at least one column.");

        const rows = table.querySelectorAll("tbody tr");
        const lines = [];
        rows.forEach((row) => {
          const cells = row.querySelectorAll("td");
          const vals = selectedIdxs.map((i) =>
            cells[i] ? cells[i].innerText.trim() : "",
          );
          if (vals.some((v) => v)) lines.push(vals.join("\t"));
        });

        await copyToClipboard(
          lines.join("\n"),
          `Copied ${lines.length} row(s) from ${selectedIdxs.length} column(s)!`,
        );
        colPanel.remove();
      };
      colPanel.appendChild(copyColBtn);

      const close = document.createElement("button");
      close.textContent = "✕ Close";
      close.style.cssText =
        "margin-top:12px;float:right;background:#dc3545;color:white;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;";
      close.onclick = () => colPanel.remove();
      colPanel.appendChild(close);

      setTimeout(() => {
        const out = (e) => {
          if (!colPanel.contains(e.target) && e.target !== hamLink) {
            colPanel.remove();
            document.removeEventListener("click", out);
          }
        };
        document.addEventListener("click", out);
      }, 0);
      document.body.appendChild(colPanel);
    });

    hamLink.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      panel.style.display = panel.style.display === "block" ? "none" : "block";
    });

    document.addEventListener("click", (e) => {
      if (!hamContainer.contains(e.target)) panel.style.display = "none";
    });

    console.log("[+] Hamburger Tools menu added");
  }

  /* ============================================================= */
  /* 2. TEMP_DEACTIVATE Button                                     */
  /* ============================================================= */
  function insertTempDeactivateButton(block) {
    if (document.getElementById("temp-deactivate-btn")) return;

    const refreshContainer = block
      .querySelector("div.ThemeGrid_Width2 i.fa-refresh")
      ?.closest("div.ThemeGrid_Width2");
    if (!refreshContainer) return;

    const tempBtn = document.createElement("button");
    tempBtn.id = "temp-deactivate-btn";
    tempBtn.textContent = "Generate TEMP_DEACTIVATE";
    tempBtn.className = "btn btn-success ThemeGrid_MarginGutter";
    tempBtn.style.marginLeft = "12px";
    tempBtn.style.fontSize = "13px";
    tempBtn.style.padding = "6px 10px";

    tempBtn.addEventListener("click", async () => {
      const table = block.querySelector("table");
      if (!table) return alert("Table not found.");

      const rows = table.querySelectorAll("tbody tr");
      const results = [];

      const startInput = document.getElementById("b132-Input_StartDate");
      const endInput = document.getElementById("b132-Input_EndDate");
      const start = startInput?.value
        ? formatDateYYYYMMDD(startInput.value)
        : "N/A";
      const end = endInput?.value ? formatDateYYYYMMDD(endInput.value) : "N/A";

      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 9) return;

        const uc4Client = cells[0].innerText.trim();
        const schedServer = cells[1].innerText.trim();
        const autoObj = cells[2].innerText.trim();
        const objType = cells[5].innerText.trim();

        if (objType === "JOBP" && autoObj) {
          const parts = autoObj.split("_");
          if (parts.length >= 4) {
            const code = parts[3];
            results.push(
              `TEMP_DEACTIVATE ${code} ${uc4Client} ${schedServer} ${start} ${end}`,
            );
          }
        }
      });

      if (!results.length) return alert("No JOBP objects found.");
      await copyToClipboard(
        results.join("\n"),
        `Copied ${results.length} TEMP_DEACTIVATE command(s)!`,
      );
    });

    refreshContainer.parentNode.insertBefore(
      tempBtn,
      refreshContainer.nextSibling,
    );
    console.log("[+] TEMP_DEACTIVATE button inserted");
  }

  function formatDateYYYYMMDD(dateStr) {
    if (!dateStr) return "N/A";
    const [y, m, d] = dateStr.split("-");
    return `${y}${m.padStart(2, "0")}${d.padStart(2, "0")}`;
  }

  async function copyToClipboard(text, successMsg) {
    try {
      await navigator.clipboard.writeText(text);
      alert(successMsg);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
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
  /* 3. Add AWI Links next to Job Name                            */
  /* ============================================================= */
  function addAwiLinks() {
    const jobNameContainers = document.querySelectorAll(
      '#b100-l5-203_0-JobName, [id$="-JobName"]',
    );

    jobNameContainers.forEach((container) => {
      if (container.dataset.awiLinkAdded) return;

      const schedServerSpan = document.querySelector(
        '#b100-l5-203_0-SchedServer span[data-expression], [id$="-SchedServer"] span[data-expression]',
      );
      const schedClientSpan = document.querySelector(
        '#b100-l5-203_0-SchedClient span[data-expression], [id$="-SchedClient"] span[data-expression]',
      );
      const jobNameBold = container.querySelector(
        'span[data-expression][style*="bold"], span[data-expression] strong, span[data-expression]',
      );

      if (!schedServerSpan || !schedClientSpan || !jobNameBold) return;

      const server = schedServerSpan.textContent.trim().toUpperCase();
      const client = schedClientSpan.textContent.trim();
      const jobName = jobNameBold.textContent.trim();

      if (!server || !client || !jobName) return;

      const awiUrl = `https://rb-${server.toLowerCase()}.bosch.com/awi/${server}/${client}@pa/view/${jobName}`;

      const link = document.createElement("a");
      link.href = awiUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.title = "Open in AWI";
      link.style.cssText = `
        margin-left: 12px;
        font-size: 14px;
        font-weight: bold;
        color: #19699b !important;
        text-decoration: underline;
      `;
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
  /* 4. Initialize everything                                      */
  /* ============================================================= */
  addHamburgerToToolbar();
  addAwiLinks();
  waitForDescriptionAndExpand();

  const awiObserver = new MutationObserver(() => setTimeout(addAwiLinks, 300));
  awiObserver.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("OSAjaxFinished", () =>
    setTimeout(addAwiLinks, 400),
  );

  const waitForReqBlock = () =>
    new Promise((res) => {
      const obs = new MutationObserver(() => {
        const block = document.querySelector(
          'div[data-block="MainFlow.REQ_CreatedObjects"]',
        );
        if (block) {
          obs.disconnect();
          res(block);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      const immediate = document.querySelector(
        'div[data-block="MainFlow.REQ_CreatedObjects"]',
      );
      if (immediate) {
        obs.disconnect();
        res(immediate);
      }
    });

  waitForReqBlock().then((block) => insertTempDeactivateButton(block));

  console.log(
    "AS-Portal Tools + AWI Link v2.3 loaded",
  );
})();
