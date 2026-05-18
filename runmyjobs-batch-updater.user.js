/**
 * UC4 / Automic - Batch ABAP_VARIANT_NAME updater (v8)
 *
 * Philosophy: v4's right-click + menu detection WORKED. This version keeps
 * that code byte-for-byte and only adds:
 *   - countResultRows scoped to .SearchResultPanel (no Home-tab false positives)
 *   - waitForSearchResults (waits for bar text + rows together)
 *   - multi-result guard with beep
 *   - Save & Close automation after setting the value
 *   - batch loop with Stop button + counter
 */
// ==UserScript==
// @name         RunMyJobs: Batch ABAP_VARIANT_NAME updater
// @namespace    bosch-asportal
// @version      1.3
// @description  Batch ABAP_VARIANT_NAME updater using UI control
// @author       Minh Dinh
// @include      https://runmyjobs-*.emea.bosch.com/redwood/ui*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(selectorFn, timeout = 20000, interval = 300) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const el = selectorFn();
      if (el) return el;
      await sleep(interval);
    }
    throw new Error("Timed out: " + selectorFn.toString().slice(0, 120));
  }

  function setReactInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /* ── Search panel — scoped, never counts Home-tab rows ─────────────────── */
  function getSearchPanel() {
    return document.querySelector(".SearchResultPanel") || null;
  }

  function countResultRows() {
    const panel = getSearchPanel();
    if (!panel) return 0;
    return panel.querySelectorAll('[data-testid^="UITableRow_"]').length;
  }

  async function waitForSearchResults(timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const bar = document.querySelector(".AdvancedSearchResultBar");
      const barText = bar ? bar.textContent : "";
      if (/\d+\s+results?\s+matching/i.test(barText) && countResultRows() > 0) return true;
      if (/^0\s/i.test(barText.trim())) return true; // zero results — handle downstream
      await sleep(300);
    }
    return false;
  }

  /* ── findResultRow — EXACT copy from v4 (the version that worked) ───────── */
  function findResultRow(jobName) {
    for (const row of document.querySelectorAll('[data-testid^="UITableRow_"]')) {
      const cell = row.querySelector('[data-testid="Name"]');
      if (cell && cell.innerText.trim() === jobName) return row;
    }
    for (const row of document.querySelectorAll("tr")) {
      const cell = row.querySelector('[data-testid="Name"]');
      if (cell && cell.innerText.trim() === jobName) return row;
    }
    for (const row of document.querySelectorAll("tr")) {
      for (const td of row.querySelectorAll("td")) {
        if (td.innerText.trim() === jobName) return row;
      }
    }
    return null;
  }

  /* ── findVariantRow + getDefaultExpressionInput — exact copy from v4 ────── */
  function findVariantRow() {
    for (const row of document.querySelectorAll("tr")) {
      const nameTd = row.querySelector('td[data-testid="Name"]');
      if (!nameTd) continue;
      const nameInput = nameTd.querySelector('input[data-testid="UITextInput"]');
      if (nameInput && nameInput.value.trim() === "ABAP_VARIANT_NAME") return row;
    }
    return null;
  }

  function getDefaultExpressionInput(row) {
    const exprTd = row.querySelector('td[data-testid="DefaultExpression"]');
    if (!exprTd) return null;
    return exprTd.querySelector('input[data-testid="UITextInput"]');
  }

  /* ── Main per-row automation ─────────────────────────────────────────────── */
  async function processRow(jobName, variantValue) {
    log(`▶ Processing: ${jobName}  →  ${variantValue}`);

    /* STEP 1 — Find Name search input; if not found go to STEP 4 first */
    let nameInput =
      [...document.querySelectorAll('input[placeholder="Name"]')].find(
        (el) => el.closest(".FiltersPanel"),
      ) ||
      document.querySelector('input[placeholder="Name"]') ||
      null;

    /* STEP 4 (fallback) — Name input not visible yet; click Search button to reveal filters */
    if (!nameInput) {
      log("  → Name input not found — clicking Search button to reveal filters...");
      const searchBtn =
        document.querySelector(".FiltersPanel .IMAGE_AETHER_SEARCH, .SearchButton .IMAGE_AETHER_SEARCH")
          ?.closest("button") ||
        [...document.querySelectorAll("button")].find((b) =>
          b.querySelector(".IMAGE_AETHER_SEARCH"),
        ) ||
        null;
      if (searchBtn) searchBtn.click();
      await sleep(600);
      nameInput = await waitFor(() => {
        const inputs = [...document.querySelectorAll('input[placeholder="Name"]')];
        return inputs.find((el) => el.closest(".FiltersPanel")) || inputs[0] || null;
      }, 8000);
    }

    /* STEP 2 — Fill */
    nameInput.focus();
    setReactInput(nameInput, "");
    await sleep(100);
    setReactInput(nameInput, jobName);
    await sleep(200);
    log("  → Name input filled");

    /* STEP 3 — Press Enter and wait for results */
    ["keydown", "keypress", "keyup"].forEach((type) =>
      nameInput.dispatchEvent(
        new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }),
      ),
    );
    await sleep(300);

    log("  → Waiting for results...");
    const got = await waitForSearchResults(15000);

    /* STEP 5 — Check results */
    if (!got) log("  ⚠ Result bar never appeared — continuing anyway");

    const rowCount = countResultRows();
    log(`  → Rows in SearchResultPanel: ${rowCount}`);

    if (rowCount === 0) throw new Error(`No results found for "${jobName}"`);

    if (rowCount > 1) {
      const msg = `⚠ ${rowCount} results for "${jobName}" — resolve manually then Resume`;
      log(msg);
      setStatus(msg, true);
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.start();
        setTimeout(() => osc.stop(), 500);
      } catch (_) {}
      throw new Error("MULTI_RESULT");
    }

    /* STEP 6 — Find result row (exact v4 logic) */
    const resultRow = await waitFor(() => findResultRow(jobName), 25000);
    log("  → Result row found");

    /* STEP 7 — Right-click; scroll into view first so rect coords are valid */
    resultRow.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(300);
    const rect = resultRow.getBoundingClientRect();
    resultRow.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 20,
        clientY: rect.top + 8,
      }),
    );
    await sleep(700);

    /* STEP 8 — Click Edit... (exact v4 logic — DO NOT change selector) */
    const editItem = await waitFor(
      () =>
        [...document.querySelectorAll('[data-testid="UIMenuItem"]')].find(
          (el) =>
            (el.querySelector(".sc-dmyCSP") || el).textContent.trim() === "Edit...",
        ),
      5000,
    );
    editItem.click();
    log("  → Edit... clicked");

    /* STEP 9 — Wait for Edit tab (exact v4 logic) */
    await waitFor(
      () =>
        [...document.querySelectorAll(".tabHeader.selected")].find(
          (el) =>
            el.textContent.includes("Edit SAP Script") ||
            el.textContent.includes(jobName.slice(0, 15)),
        ),
      20000,
    );
    log("  → Edit tab opened");
    await sleep(1200);

    /* STEP 10 — Click Parameters (exact v4 logic) */
    const paramsNav = await waitFor(() =>
      [...document.querySelectorAll(".ULNavListItem")].find(
        (el) => el.innerText.trim() === "Parameters",
      ),
    );
    paramsNav.click();
    log("  → Parameters clicked");
    await sleep(1500);

    /* STEP 11 — Find ABAP_VARIANT_NAME row (exact v4 logic) */
    const variantRow = await waitFor(() => findVariantRow(), 12000);
    log("  → ABAP_VARIANT_NAME row found");
    await sleep(200);

    /* STEP 12 — Set value (exact v4 logic) */
    const exprInput = getDefaultExpressionInput(variantRow);
    if (!exprInput) throw new Error("DefaultExpression input not found in ABAP_VARIANT_NAME row");

    log(`  → Current value: "${exprInput.value}"`);

    const exprTd = variantRow.querySelector('td[data-testid="DefaultExpression"]');
    exprTd.click();
    await sleep(400);

    const activeExprInput = getDefaultExpressionInput(variantRow) || exprInput;
    activeExprInput.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await sleep(200);
    activeExprInput.focus();
    await sleep(100);
    activeExprInput.select();
    await sleep(50);

    setReactInput(activeExprInput, variantValue);
    activeExprInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    activeExprInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    await sleep(200);

    const finalInput = getDefaultExpressionInput(variantRow) || activeExprInput;
    log(`  ✓ Set to: "${finalInput.value}"`);
    if (finalInput.value !== variantValue) {
      log(`  ⚠ Mismatch! Expected "${variantValue}", got "${finalInput.value}"`);
    }

    /* STEP 13 — Save & Close; fall back to Cancel if Save & Close is disabled */
    await sleep(400);
    const saveCloseBtn = document.querySelector('button[data-testid="UIButton_SaveClose"]:not([disabled])');
    if (saveCloseBtn) {
      saveCloseBtn.click();
      log("  → Save & Close clicked");
    } else {
      const cancelBtn = document.querySelector('button[data-testid="UIButton_Cancel"]');
      if (!cancelBtn) throw new Error("Neither Save & Close nor Cancel button found");
      cancelBtn.click();
      log("  → Save & Close was disabled — Cancel clicked instead");
    }

    /* STEP 14 — Wait for Edit tab to close (NEW) */
    await waitFor(
      () => ![...document.querySelectorAll(".tabHeader")].some(
        (el) => el.textContent.includes("Edit SAP Script"),
      ),
      15000,
    );
    log("  ✓ Edit tab closed");
    await sleep(500);
  }

  /* ── Helpers ─────────────────────────────────────────────────────────────── */
  function log(msg) {
    const box = document.getElementById("uc4-log");
    if (!box) return console.log("[UC4]", msg);
    const line = document.createElement("div");
    line.style.cssText = "padding:2px 0; border-bottom:1px solid rgba(0,0,0,0.06);";
    line.textContent = msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    console.log("[UC4]", msg);
  }

  function setStatus(msg, warn = false) {
    const el = document.getElementById("uc4-status");
    if (!el) return;
    el.textContent = msg;
    el.style.color = warn ? "#c0392b" : "#666";
    el.style.fontWeight = warn ? "600" : "normal";
  }

  function removeFirstRow() {
    const ta = document.getElementById("uc4-input");
    if (!ta) return;
    const lines = ta.value.split("\n").filter((l) => l.trim());
    lines.shift();
    ta.value = lines.join("\n");
  }

  function getRemainingRows() {
    const ta = document.getElementById("uc4-input");
    if (!ta) return [];
    return ta.value
      .split("\n")
      .map((l) => l.split("\t").map((s) => s.trim()))
      .filter((r) => r.length >= 2 && r[0] && r[1]);
  }

  /* ── Debug helpers ───────────────────────────────────────────────────────── */
  window.uc4DebugParams = function () {
    console.group("[UC4] Parameters debug");
    const row = findVariantRow();
    if (row) {
      const inp = getDefaultExpressionInput(row);
      console.log("Row:", row, "| input:", inp, "| value:", inp?.value, "| readonly:", inp?.readOnly);
    } else {
      console.warn("ABAP_VARIANT_NAME row not found");
      [...document.querySelectorAll("tr")]
        .filter((r) => r.querySelector('td[data-testid="Name"]'))
        .forEach((r) =>
          console.log(r.querySelector('td[data-testid="Name"] input')?.value, r),
        );
    }
    console.groupEnd();
  };

  window.uc4Debug = function () {
    console.group("[UC4] Search panel & result rows");
    const panel = getSearchPanel();
    console.log("SearchPanel:", panel);
    const rows = panel ? panel.querySelectorAll('[data-testid^="UITableRow_"]') : [];
    console.log(`Result rows: ${rows.length}`);
    rows.forEach((r, i) => {
      const cell = r.querySelector('[data-testid="Name"]');
      console.log(`  Row ${i}:`, cell ? `"${cell.innerText.trim()}"` : "(no Name cell)");
    });
    console.groupEnd();
  };

  /* ── UI ──────────────────────────────────────────────────────────────────── */
  function buildUI() {
    document.getElementById("uc4-bot-panel")?.remove();

    const panel = document.createElement("div");
    panel.id = "uc4-bot-panel";
    panel.style.cssText = `
      position:fixed; bottom:24px; right:24px; z-index:99999;
      width:460px; background:#fff; border:1px solid #c0c0c0;
      border-radius:10px; box-shadow:0 6px 28px rgba(0,0,0,0.2);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:13px; color:#222; overflow:hidden;
    `;

    panel.innerHTML = `
      <div id="uc4-header" style="
        background:#1a56db;color:#fff;padding:10px 14px;
        display:flex;justify-content:space-between;align-items:center;
        cursor:move;user-select:none;border-radius:10px 10px 0 0;">
        <span style="font-weight:600;font-size:13px;">⚙ UC4 Batch ABAP_VARIANT Updater v8</span>
        <button id="uc4-minimize" style="background:none;border:none;color:#fff;cursor:pointer;font-size:18px;line-height:1;padding:0 4px;">─</button>
      </div>
      <div id="uc4-body" style="padding:12px;">
        <p style="margin:0 0 6px;color:#444;font-size:12px;">Paste 2-column tab-separated data (copy from Excel):</p>
        <textarea id="uc4-input" rows="7" style="
          width:100%;box-sizing:border-box;resize:vertical;
          border:1px solid #ccc;border-radius:6px;padding:8px;
          font-family:monospace;font-size:11px;background:#fafafa;"
          placeholder="JSAP_X79_011_004RUZ_LE_EB_XXXX_LE93701_RLLL05SE&#9;UC4_089M"></textarea>

        <div style="display:flex;gap:8px;margin-top:8px;">
          <button id="uc4-start" style="
            flex:1;padding:8px;border:none;border-radius:6px;
            background:#1a56db;color:#fff;cursor:pointer;font-weight:600;font-size:13px;">
            ▶ Start / Resume
          </button>
          <button id="uc4-stop" style="
            padding:8px 12px;border:none;border-radius:6px;
            background:#c0392b;color:#fff;cursor:pointer;font-weight:600;font-size:13px;"
            disabled>⏹ Stop</button>
          <button id="uc4-debugbtn" style="
            padding:8px 10px;border:1px solid #ccc;border-radius:6px;
            background:#f5f5f5;color:#333;cursor:pointer;font-size:12px;"
            title="Debug in DevTools console (F12)">🔍</button>
        </div>

        <div id="uc4-status" style="margin-top:8px;font-size:12px;color:#666;font-style:italic;">Ready.</div>

        <div style="margin-top:8px;font-size:11px;font-weight:600;color:#333;">Log</div>
        <div id="uc4-log" style="
          height:180px;overflow-y:auto;background:#f8f8f8;
          border:1px solid #e0e0e0;border-radius:6px;padding:6px;
          margin-top:4px;font-family:monospace;color:#333;font-size:11px;"></div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;">
          <button id="uc4-clearlog" style="
            padding:3px 10px;border:1px solid #ddd;border-radius:4px;
            background:#fff;color:#666;cursor:pointer;font-size:11px;">Clear log</button>
          <span id="uc4-counter" style="font-size:11px;color:#888;line-height:24px;"></span>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    /* Drag */
    const header = panel.querySelector("#uc4-header");
    let ox = 0, oy = 0, dragging = false;
    header.addEventListener("mousedown", (e) => {
      if (e.target.id === "uc4-minimize") return;
      dragging = true;
      ox = e.clientX - panel.getBoundingClientRect().left;
      oy = e.clientY - panel.getBoundingClientRect().top;
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = e.clientX - ox + "px";
      panel.style.top = e.clientY - oy + "px";
    });
    document.addEventListener("mouseup", () => (dragging = false));

    /* Minimize */
    const body = panel.querySelector("#uc4-body");
    panel.querySelector("#uc4-minimize").addEventListener("click", () => {
      body.style.display = body.style.display === "none" ? "" : "none";
      panel.querySelector("#uc4-minimize").textContent =
        body.style.display === "none" ? "□" : "─";
    });

    panel.querySelector("#uc4-clearlog").addEventListener(
      "click", () => (document.getElementById("uc4-log").innerHTML = ""),
    );
    panel.querySelector("#uc4-debugbtn").addEventListener("click", () => {
      window.uc4Debug();
      window.uc4DebugParams();
      log("→ Debug output in DevTools console (F12)");
    });

    const startBtn = panel.querySelector("#uc4-start");
    const stopBtn  = panel.querySelector("#uc4-stop");
    let stopFlag = false;

    stopBtn.addEventListener("click", () => { stopFlag = true; });

    startBtn.addEventListener("click", async () => {
      if (!getRemainingRows().length) { alert("No data — paste your rows first."); return; }

      stopFlag = false;
      startBtn.disabled = true;
      stopBtn.disabled = false;

      let processed = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (stopFlag) { log("⏹ Stopped by user."); setStatus("Stopped."); break; }

        const rows = getRemainingRows();
        if (!rows.length) break;

        const [jobName, variantValue] = rows[0];
        setStatus(`Processing ${jobName} | ${rows.length} remaining`);
        document.getElementById("uc4-counter").textContent = `${rows.length} left`;

        try {
          await processRow(jobName, variantValue);
          removeFirstRow();
          processed++;
          const left = getRemainingRows().length;
          log(`  ── Done (${left} left) ──`);
          document.getElementById("uc4-counter").textContent = `${left} left`;
        } catch (err) {
          if (err.message === "MULTI_RESULT") {
            setStatus(`⚠ Multiple results for "${jobName}" — resolve manually, then Resume`, true);
          } else {
            log(`✗ ERROR on "${jobName}": ${err.message}`);
            setStatus("Error — see log. Fix and click Resume to continue.", true);
          }
          break;
        }
      }

      if (!getRemainingRows().length && !stopFlag) {
        setStatus(`✅ All done! ${processed} row(s) processed.`);
        log("✅ All rows complete.");
      }

      startBtn.disabled = false;
      stopBtn.disabled = true;
      document.getElementById("uc4-counter").textContent = `${getRemainingRows().length} left`;
    });
  }

  function init() {
    buildUI();
    console.log("[UC4 Bot v8] Ready. Call uc4Debug() or uc4DebugParams() in console anytime.");
  }

  function waitForBody(cb) {
    if (document.body) { cb(); return; }
    const iv = setInterval(() => {
      if (document.body) { clearInterval(iv); cb(); }
    }, 50);
  }

  waitForBody(init);
})();
