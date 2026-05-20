/**
 * UC4 Workflow Child Job Scanner (v11)
 *
 * Flow:
 *  1. Search for "Minh_Test_GetJobchainStepCall"
 *  2. Right-click → Run...
 *  3. Fill popup: Chain name = pasted WF names, Partition = input value
 *  4. Click Run → popup closes
 *  5. Right-click on same result → Monitor related jobs → new tab opens
 *  6. Click first row in related jobs table → right panel appears
 *  7. Click stdout.log link → done
 */

(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const TARGET_JOB = "Minh_Test_GetJobchainStepCall";

  async function waitFor(fn, timeout = 20000, interval = 300) {
    const dl = Date.now() + timeout;
    while (Date.now() < dl) {
      const el = fn(); if (el) return el;
      await sleep(interval);
    }
    throw new Error("Timed out: " + fn.toString().slice(0, 100));
  }

  function setReactInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /* ── Search helpers ──────────────────────────────────────────────────────── */
  function getSearchPanel() { return document.querySelector(".SearchResultPanel") || null; }

  function countResultRows() {
    const p = getSearchPanel();
    return p ? p.querySelectorAll('[data-testid^="UITableRow_"]').length : 0;
  }

  async function waitForSearchResults(timeout = 15000) {
    const dl = Date.now() + timeout;
    while (Date.now() < dl) {
      const bar = document.querySelector(".AdvancedSearchResultBar");
      const t = bar ? bar.textContent : "";
      if (/\d+\s+results?\s+matching/i.test(t) && countResultRows() > 0) return true;
      if (/^0\s/i.test(t.trim())) return true;
      await sleep(300);
    }
    return false;
  }

  function findResultRow(name) {
    const panel = getSearchPanel() || document;
    for (const row of panel.querySelectorAll('[data-testid^="UITableRow_"]')) {
      const c = row.querySelector('[data-testid="Name"]');
      if (c && c.innerText.trim() === name) return row;
    }
    for (const row of document.querySelectorAll("tr")) {
      const c = row.querySelector('[data-testid="Name"]');
      if (c && c.innerText.trim() === name) return row;
    }
    return null;
  }

  /* ── Context menu helpers ────────────────────────────────────────────────── */
  async function rightClickRow(row) {
    row.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(300);
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true,
      clientX: rect.left + 20, clientY: rect.top + 8,
    }));
    await sleep(700);
  }

  async function clickMenuItem(label) {
    const item = await waitFor(() =>
      [...document.querySelectorAll('[data-testid="UIMenuItem"]')].find(
        (el) => (el.querySelector(".sc-dmyCSP") || el).textContent.trim() === label,
      ), 6000,
    );
    item.click();
  }

  /* ── Search for TARGET_JOB ───────────────────────────────────────────────── */
  async function searchForTarget() {
    // Find / reveal Name input
    let nameInput =
      [...document.querySelectorAll('input[placeholder="Name"]')].find((el) => el.closest(".FiltersPanel")) ||
      document.querySelector('input[placeholder="Name"]') || null;

    if (!nameInput) {
      log("  → Revealing filters...");
      const btn =
        document.querySelector(".FiltersPanel .IMAGE_AETHER_SEARCH, .SearchButton .IMAGE_AETHER_SEARCH")?.closest("button") ||
        [...document.querySelectorAll("button")].find((b) => b.querySelector(".IMAGE_AETHER_SEARCH")) || null;
      if (btn) btn.click();
      await sleep(600);
      nameInput = await waitFor(() => {
        const ins = [...document.querySelectorAll('input[placeholder="Name"]')];
        return ins.find((el) => el.closest(".FiltersPanel")) || ins[0] || null;
      }, 8000);
    }

    nameInput.focus();
    setReactInput(nameInput, "");
    await sleep(100);
    setReactInput(nameInput, TARGET_JOB);
    await sleep(200);

    ["keydown", "keypress", "keyup"].forEach((t) =>
      nameInput.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })),
    );
    await sleep(300);
    log("  → Waiting for search results...");
    await waitForSearchResults(15000);
  }

  /* ── Main flow ───────────────────────────────────────────────────────────── */
  async function run(chainNames, partition) {
    log(`▶ Searching for "${TARGET_JOB}"...`);
    await searchForTarget();

    const rowCount = countResultRows();
    if (rowCount === 0) throw new Error(`"${TARGET_JOB}" not found in search results`);
    log(`  → ${rowCount} result(s) found`);

    const resultRow = await waitFor(() => findResultRow(TARGET_JOB), 10000);
    log("  → Result row found");

    /* STEP 1 — Right-click → Run... */
    await rightClickRow(resultRow);
    await clickMenuItem("Run...");
    log("  → Run... clicked");

    /* STEP 2 — Fill popup: Chain name + Partition */
    log("  → Waiting for Run popup...");

    // Wait for the dialog — identified by the SubmitWizard or ULDialog-Page
    const dialog = await waitFor(() =>
      document.querySelector(".SubmitWizard, .ULDialog-Page") || null,
      10000,
    );

    // Navigate to Parameters nav item if not already active
    await sleep(500);
    const paramsNav = [...document.querySelectorAll(".ULNavListItem")]
      .find((el) => el.textContent.trim() === "Parameters" && !el.classList.contains("Disabled"));
    if (paramsNav) { paramsNav.click(); await sleep(500); }

    // Chain name field — UILabelField whose label says "Chain name"
    const chainInput = await waitFor(() => {
      for (const lf of document.querySelectorAll('[data-testid="UILabelField"]')) {
        const label = lf.querySelector('[data-testid="UILabel"] [data-testid="UIText"], [data-testid="UILabel"]');
        if (!label) continue;
        if (label.textContent.trim() === "Chain name") {
          return lf.querySelector('input[data-testid="UITextInput"]') || null;
        }
      }
      return null;
    }, 8000);

    log(`  → Chain name field found (current: "${chainInput.value}")`);
    chainInput.focus();
    setReactInput(chainInput, chainNames);
    await sleep(200);
    log(`  → Chain name set to: "${chainNames.slice(0, 60)}${chainNames.length > 60 ? "…" : ""}"`);

    // Partition field
    const partitionInput = await waitFor(() => {
      for (const lf of document.querySelectorAll('[data-testid="UILabelField"]')) {
        const label = lf.querySelector('[data-testid="UILabel"] [data-testid="UIText"], [data-testid="UILabel"]');
        if (!label) continue;
        if (label.textContent.trim() === "Partition") {
          const inp = lf.querySelector('input[data-testid="UITextInput"]');
          if (inp) return inp;
        }
      }
      return null;
    }, 5000);

    log(`  → Partition field found (current: "${partitionInput.value}")`);
    partitionInput.focus();
    setReactInput(partitionInput, partition);
    await sleep(200);
    log(`  → Partition set to: "${partition}"`);

    /* STEP 3 — Click Run button in popup */
    const runBtn = await waitFor(() => {
      return [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === "Run" && !b.disabled,
      ) || null;
    }, 5000);
    runBtn.click();
    log("  → Run button clicked");

    /* STEP 4 — Wait for popup to close */
    await waitFor(() => !document.querySelector(".SubmitWizard, .ULDialog-Page"), 15000);
    log("  → Popup closed");
    await sleep(800);

    /* STEP 5 — Right-click on result again → Monitor related jobs */
    const resultRow2 = await waitFor(() => findResultRow(TARGET_JOB), 10000);
    await rightClickRow(resultRow2);
    await clickMenuItem("Monitor related jobs");
    log("  → Monitor related jobs clicked");

    /* STEP 6 — Wait for the related jobs tab to open and show results */
    log("  → Waiting for related jobs tab...");
    // The tab content shows a table with Job.SearchDescription column
    await waitFor(() =>
      document.querySelector('[data-testid="UIColumn_Job.SearchDescription"]') ||
      document.querySelector('[data-testid^="UITableRow_"]'), 20000,
    );
    await sleep(1000);

    /* STEP 7 — Click the first row in the related jobs table */
    const firstRow = await waitFor(() => {
      // Look for rows inside the related jobs overview table
      // They have data-testid="UITableRow_N" and contain Job.SearchDescription cells
      const rows = [...document.querySelectorAll('[data-testid^="UITableRow_"]')]
        .filter((r) => r.querySelector('[data-testid="Job.SearchDescription"]'));
      return rows[0] || null;
    }, 10000);

    firstRow.click();
    log("  → First related job row clicked");
    await sleep(1000);

    /* STEP 8 — Click stdout.log in the right panel */
    const stdoutLink = await waitFor(() => {
      // The link has data-testid="UIText_JobFile_Link_Stdout.log" or just text "stdout.log"
      return (
        document.querySelector('[data-testid="UIText_JobFile_Link_Stdout.log"] a') ||
        [...document.querySelectorAll("a")].find((a) => a.textContent.trim() === "stdout.log") ||
        null
      );
    }, 10000);

    stdoutLink.click();
    log("  ✓ stdout.log clicked — done!");
    setStatus("✅ Done! stdout.log opened.");
  }

  /* ── Helpers ─────────────────────────────────────────────────────────────── */
  function log(msg) {
    const box = document.getElementById("uc4-log");
    if (!box) return console.log("[UC4]", msg);
    const line = document.createElement("div");
    line.style.cssText = "padding:2px 0;border-bottom:1px solid rgba(0,0,0,0.06);";
    line.textContent = msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    console.log("[UC4]", msg);
  }

  function setStatus(msg, warn = false) {
    const el = document.getElementById("uc4-status");
    if (!el) return;
    el.textContent = msg;
    el.style.color = warn ? "#c0392b" : "#27ae60";
    el.style.fontWeight = warn ? "600" : "500";
  }

  /* ── Build UI ────────────────────────────────────────────────────────────── */
  function buildUI() {
    document.getElementById("uc4-wf-panel")?.remove();

    const panel = document.createElement("div");
    panel.id = "uc4-wf-panel";
    panel.style.cssText = `
      position:fixed; top:40px; right:20px; z-index:99999;
      width:520px; max-width:97vw;
      background:#fff; border:1px solid #c0c0c0;
      border-radius:10px; box-shadow:0 6px 28px rgba(0,0,0,0.22);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:13px; color:#222; overflow:hidden;
    `;

    panel.innerHTML = `
      <div id="uc4-header" style="
        background:#0a7c59;color:#fff;padding:10px 14px;
        display:flex;justify-content:space-between;align-items:center;
        cursor:move;user-select:none;border-radius:10px 10px 0 0;">
        <span style="font-weight:600;font-size:13px;">🔍 WF Child Job Scanner v11</span>
        <button id="uc4-minimize" style="background:none;border:none;color:#fff;cursor:pointer;font-size:18px;line-height:1;padding:0 4px;">─</button>
      </div>

      <div id="uc4-body" style="padding:14px;display:flex;flex-direction:column;gap:10px;">

        <div style="font-size:11px;color:#666;line-height:1.6;">
          Paste workflow names (space-separated or one per line) into <strong>Chain name</strong>.
          The script runs <code style="background:#f0f4ff;padding:1px 4px;border-radius:3px;">${TARGET_JOB}</code>
          and opens the stdout log automatically.
        </div>

        <!-- Chain name -->
        <div>
          <label style="font-size:11px;font-weight:600;color:#333;display:block;margin-bottom:4px;">
            Chain name <span style="color:#888;font-weight:normal;">(workflow names, space-separated)</span>
          </label>
          <textarea id="uc4-chainname" rows="5" style="
            width:100%;box-sizing:border-box;resize:vertical;
            border:1px solid #ccc;border-radius:6px;padding:8px;
            font-family:monospace;font-size:11px;background:#fafafa;outline:none;"
            placeholder="WF_X70_SINGLE_0022F0_XX_011_RPTEXTPT_ATTENDANCES_14 WF_XH1_SINGLE_0022BZ_XX_011_RPTIME00_UC4_MY_TE&#10;WF_X70_SINGLE_0022JG_HR_011_Z06PDE04_ZPTQTA00_NSU_IT200625_JAN&#10;…"></textarea>
          <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:4px;">
            <button id="uc4-join" style="
              padding:3px 10px;border:1px solid #ccc;border-radius:4px;
              background:#f5f5f5;color:#555;cursor:pointer;font-size:11px;"
              title="Join all lines into one space-separated string">Join lines → single line</button>
            <span id="uc4-wf-count" style="font-size:11px;color:#888;line-height:24px;"></span>
          </div>
        </div>

        <!-- Partition -->
        <div style="display:flex;gap:10px;align-items:flex-start;">
          <div style="flex:1;">
            <label style="font-size:11px;font-weight:600;color:#333;display:block;margin-bottom:4px;">Partition</label>
            <input id="uc4-partition" type="text" value="P1113" style="
              width:100%;box-sizing:border-box;
              border:1px solid #ccc;border-radius:6px;padding:7px 10px;
              font-size:12px;font-family:monospace;background:#fafafa;outline:none;">
          </div>
          <div style="flex:0 0 auto;padding-top:20px;">
            <select id="uc4-partition-select" style="
              border:1px solid #ccc;border-radius:6px;padding:7px 8px;
              font-size:12px;background:#fafafa;cursor:pointer;outline:none;">
              <option value="">— quick select —</option>
              <option value="P1113">P1113</option>
              <option value="P1001">P1001</option>
              <option value="p1113">p1113</option>
            </select>
          </div>
        </div>

        <!-- Run button -->
        <div style="display:flex;gap:8px;">
          <button id="uc4-run" style="
            flex:1;padding:9px;border:none;border-radius:6px;
            background:#0a7c59;color:#fff;cursor:pointer;font-weight:600;font-size:13px;">
            ▶ Run
          </button>
          <button id="uc4-clearlog" style="
            padding:9px 12px;border:1px solid #ddd;border-radius:6px;
            background:#f5f5f5;color:#555;cursor:pointer;font-size:12px;">
            🗑 Clear log
          </button>
        </div>

        <!-- Status -->
        <div id="uc4-status" style="font-size:12px;color:#555;font-style:italic;min-height:16px;">Ready.</div>

        <!-- Log -->
        <div style="font-size:11px;font-weight:600;color:#333;margin-bottom:-4px;">Log</div>
        <div id="uc4-log" style="
          height:180px;overflow-y:auto;background:#f8f8f8;
          border:1px solid #e0e0e0;border-radius:6px;padding:6px;
          font-family:monospace;color:#333;font-size:11px;"></div>

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
      panel.style.right = "auto"; panel.style.bottom = "auto";
      panel.style.left = e.clientX - ox + "px";
      panel.style.top  = e.clientY - oy + "px";
    });
    document.addEventListener("mouseup", () => (dragging = false));

    /* Minimize */
    const body = panel.querySelector("#uc4-body");
    panel.querySelector("#uc4-minimize").addEventListener("click", () => {
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "" : "none";
      panel.querySelector("#uc4-minimize").textContent = hidden ? "─" : "□";
    });

    /* Clear log */
    panel.querySelector("#uc4-clearlog").addEventListener("click", () => {
      document.getElementById("uc4-log").innerHTML = "";
      setStatus("Ready.");
    });

    /* Partition quick-select */
    panel.querySelector("#uc4-partition-select").addEventListener("change", (e) => {
      if (e.target.value) {
        panel.querySelector("#uc4-partition").value = e.target.value;
        e.target.value = "";
      }
    });

    /* WF count + join */
    const chainTA = panel.querySelector("#uc4-chainname");
    const wfCount = panel.querySelector("#uc4-wf-count");

    function updateCount() {
      const names = chainTA.value.trim().split(/[\s\n]+/).filter(Boolean);
      wfCount.textContent = names.length ? `${names.length} WF name${names.length !== 1 ? "s" : ""}` : "";
    }

    chainTA.addEventListener("input", updateCount);
    chainTA.addEventListener("paste", () => setTimeout(updateCount, 0));

    panel.querySelector("#uc4-join").addEventListener("click", () => {
      const names = chainTA.value.trim().split(/[\s\n]+/).filter(Boolean);
      chainTA.value = names.join(" ");
      updateCount();
    });

    /* Run */
    const runBtn = panel.querySelector("#uc4-run");
    runBtn.addEventListener("click", async () => {
      const chainRaw = chainTA.value.trim();
      if (!chainRaw) { alert("Paste at least one workflow name."); return; }

      // Normalise: join lines with space (the field expects space-separated)
      const chainNames = chainRaw.split(/\n+/).map((l) => l.trim()).filter(Boolean).join(" ");
      const partition  = panel.querySelector("#uc4-partition").value.trim() || "P1113";

      runBtn.disabled = true;
      setStatus("Running…");
      document.getElementById("uc4-log").innerHTML = "";

      try {
        await run(chainNames, partition);
      } catch (err) {
        log(`✗ ERROR: ${err.message}`);
        setStatus(`Error — ${err.message}`, true);
      }

      runBtn.disabled = false;
    });
  }

  /* ── Boot ────────────────────────────────────────────────────────────────── */
  function waitForBody(cb) {
    if (document.body) { cb(); return; }
    const iv = setInterval(() => { if (document.body) { clearInterval(iv); cb(); } }, 50);
  }

  waitForBody(() => {
    buildUI();
    console.log("[UC4 WF Scanner v11] Ready.");
  });
})();
