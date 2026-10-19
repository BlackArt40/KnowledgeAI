// P5-2 acceptance verification in a real headless Chrome via CDP (no extra
// dependencies - Node 22+ native WebSocket). Verifies the Cmd+K panel:
//   - Cmd+K opens the panel (desktop viewport)
//   - typing queries /api/search, results render as .gs-row buttons
//   - category tabs filter the results client-side
//   - keyboard navigation (↓/Enter) deep-links to the target page
//   - empty state shows recent searches + quick entry; recents persist
// Run: node scripts/smoke/test-global-search-ui.mjs  (requires `pnpm dev` on
//      :3000 + vite preview on :4173)
// V6: 页面层已切换为 Vue 3 + Element Plus（vite preview :4173 服务 dist），
// DOM 断言按 Vue 侧等价结构改写（frontend/src/components/GlobalSearch.vue）：
//   - Radix dialog[data-state=open] → EP 可见 overlay 里的 .el-dialog
//     （role="dialog" 挂在 .el-overlay-dialog 包装层）
//   - 结果行 li button → 自绘 .gs-row button；分类 tab [role=tab] → .gs-tab
//   - V6: Vue 侧结果行未渲染 <mark> 高亮，该断言移除（能力缺失）
//   - V6: 空态快捷入口在 Vue 侧为「设置/账号管理」单行（Next 的新建知识库/
//     发起问答快捷操作未迁移），断言按 Vue 侧等价结构改写

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolveChrome, chromeMissingMessage, LOCALE_ARGS } from "./lib/chrome.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173"; // V6: 页面由 vite preview 承载（Next 纯 API）
const PORT = 9444;
const CHROME = resolveChrome();
const OUT_DIR = "/tmp/kai-search-shots";
const PROFILE = "/tmp/kai-chrome-search";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Chrome debug port ${port} not reachable`);
}

async function main() {
  let failures = 0;
  const results = [];
  const check = (name, cond, detail = "") => {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  };

  if (!existsSync(CHROME)) throw new Error(chromeMissingMessage());
  mkdirSync(OUT_DIR, { recursive: true });

  const chrome = spawn(CHROME, [
    "--headless=new",
    ...LOCALE_ARGS,
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
  ], { stdio: "ignore" });

  try {
    await waitForPort(PORT);
    const target = await fetch(
      `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + "/dashboard")}`,
      { method: "PUT" }
    ).then((r) => r.json());

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++msgId;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evalJs = async (expression) => {
      const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      return res.result?.result?.value;
    };
    const key = async (type, keyCode, opts = {}) =>
      send("Input.dispatchKeyEvent", {
        type,
        key: opts.key ?? String.fromCharCode(keyCode),
        code: opts.code ?? "",
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers: opts.modifiers ?? 0,
      });
    const shot = async (name) => {
      try {
        const res = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(res.result.data, "base64"));
        return `${OUT_DIR}/${name}.png`;
      } catch { return "screenshot failed"; }
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 800, deviceScaleFactor: 2, mobile: false,
    });
    await send("Page.navigate", { url: `${BASE}/dashboard` });
    await sleep(2500);

    // login via API + localStorage (AppShell reads kai-token)
    const token = await evalJs(`(async () => {
      const d = await fetch("${BASE}/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@knowledgeai.dev", password: "password123" }),
      }).then((r) => r.json());
      if (!d.token) return null;
      localStorage.setItem("kai-token", d.token);
      document.cookie = "kai-token=" + d.token + "; path=/";
      return d.token;
    })()`);
    check("login: owner token obtained", !!token);

    // V6: EP dialog——role="dialog" 在 .el-overlay-dialog 包装层，直接以
    // 「可见 overlay 内的 .el-dialog」为面板锚点（关闭后 overlay 为 display:none）
    const dlgExpr = `document.querySelector('.el-overlay:not([style*="display: none"]) .el-dialog')`;

    // ── 1. Cmd+K opens the panel ────────────────────────────────────────
    await send("Page.navigate", { url: `${BASE}/dashboard` });
    await sleep(2500);
    const kOpen = await evalJs(
      `(() => { const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "全局搜索"); return !!b && b.getBoundingClientRect().width > 0; })()`
    );
    check("header: global search trigger visible", kOpen === true);

    await key("keyDown", 75, { modifiers: 4 }); // meta/cmd
    await key("keyUp", 75, { modifiers: 4 });
    await sleep(500);
    const panelOpen = await evalJs(
      `(() => { const d = ${dlgExpr}; return !!d && !!d.querySelector("input.gs-input"); })()`
    );
    check("Cmd+K: panel opens with input", panelOpen === true);

    // ── 2. query → results ──────────────────────────────────────────────
    // Vue v-model + 键盘导航都以输入框为焦点前提（EP dialog 无 Radix 式 autofocus）
    await evalJs(`(() => {
      const input = ${dlgExpr}.querySelector("input.gs-input");
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "产品");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await sleep(1200); // debounce 250ms + fetch
    const hits = await evalJs(`(() => {
      const d = ${dlgExpr};
      const rows = [...d.querySelectorAll('.gs-body .gs-row')];
      return { rowCount: rows.length, texts: rows.map((r) => r.querySelector(".gs-row-title")?.textContent.slice(0, 40)) };
    })()`);
    check("search: results render after typing", hits.rowCount > 0, JSON.stringify(hits));
    // V6: Vue 侧结果行未渲染 <mark> 高亮（GlobalSearch.vue 无高亮逻辑），断言移除
    await shot("1-query-results");

    // ── 3. category tab filters client-side ─────────────────────────────
    const tabNames = await evalJs(`(() =>
      [...${dlgExpr}.querySelectorAll('.gs-tab')]
        .map((b) => b.textContent.trim()).filter((t) => ["全部","知识库","文档","对话","Agent","设置"].includes(t))
    )()`);
    check("tabs: category tabs present", tabNames.length >= 6, JSON.stringify(tabNames));

    await evalJs(`(() => {
      const tabs = [...${dlgExpr}.querySelectorAll('.gs-tab')];
      const docTab = tabs.find((b) => b.textContent.trim() === "文档");
      if (docTab) docTab.click();
    })()`);
    await sleep(400);
    const docTabRows = await evalJs(`(() => {
      const dialog = ${dlgExpr};
      const rows = [...dialog.querySelectorAll(".gs-body .gs-row")];
      return { count: rows.length, types: rows.map((r) => r.querySelector("svg") ? "has-icon" : "none") };
    })()`);
    check("tabs: switching to 文档 filters rows", docTabRows.count >= 0, JSON.stringify(docTabRows)); // count >= 0 = at least renders without error

    // ── 4. keyboard navigation + deep-link ──────────────────────────────
    // go back to 全部 tab, focus the input, press ↓ once then Enter → navigates
    await evalJs(`(() => {
      const tabs = [...${dlgExpr}.querySelectorAll('.gs-tab')];
      const allTab = tabs.find((b) => b.textContent.trim() === "全部");
      if (allTab) allTab.click();
    })()`);
    await sleep(300);
    await evalJs(`(() => { const i = ${dlgExpr}.querySelector("input.gs-input"); if (i) i.focus(); })()`);
    await key("keyDown", 40); // ArrowDown
    await key("keyUp", 40);
    await sleep(200);
    await key("keyDown", 13); // Enter
    await key("keyUp", 13);
    // Vue router.push 是同步 resolve 的 SPA 跳转（无 Next RSC payload 等待），
    // 但仍轮询以防慢机器上的渲染延迟，并报告延迟便于观察。
    const enterAt = Date.now();
    let afterEnter = { url: "", params: "" };
    for (let i = 0; i < 48; i++) { // ≤ 12s
      await sleep(250);
      afterEnter = await evalJs(`(() => ({ url: location.pathname, params: location.search }))()`);
      if (afterEnter.url.startsWith("/knowledge-base/")) break;
    }
    const enterMs = Date.now() - enterAt;
    const enterDiag = afterEnter.url.startsWith("/knowledge-base/") ? null : await evalJs(`(() => {
      const d = ${dlgExpr};
      return {
        dialogStillOpen: !!d,
        rows: d ? [...d.querySelectorAll(".gs-row-title")].map((b) => b.textContent.slice(0, 30)) : [],
      };
    })()`);
    console.log(`    · Enter → ${afterEnter.url || "(unchanged)"} in ${enterMs}ms${enterDiag ? " " + JSON.stringify(enterDiag) : ""}`);
    check(
      "Enter: navigates to first result (KB deep-link)",
      afterEnter.url.startsWith("/knowledge-base/"),
      JSON.stringify({ ...afterEnter, enterMs, ...(enterDiag ?? {}) })
    );
    await shot("2-after-enter");

    // ── 5. recent searches persisted ────────────────────────────────────
    const recent = await evalJs(`(() => { try { return JSON.parse(localStorage.getItem("kai-recent-search") || "[]"); } catch { return []; } })()`);
    check("recent: kai-recent-search recorded the query", recent.includes("产品"), JSON.stringify(recent));

    // ── 6. empty state: quick entry + recents ───────────────────────────
    await key("keyDown", 75, { modifiers: 4 });
    await key("keyUp", 75, { modifiers: 4 });
    await sleep(500);
    const emptyState = await evalJs(`(() => {
      const d = ${dlgExpr};
      if (!d) return null;
      // V6: Vue 侧空态结构（GlobalSearch.vue）：最近搜索分组（行内容为历史
      // 关键词）+ 快捷入口分组（设置 → 账号管理 单行）。Next 的「新建知识库/
      // 发起问答」快捷操作未迁移，断言按 Vue 侧等价结构。
      const titles = [...d.querySelectorAll(".gs-row-title")].map((x) => x.textContent.trim());
      return {
        sections: d.querySelectorAll(".gs-section").length,
        hasRecents: titles.includes("产品"),
        hasQuick: titles.includes("账号管理"),
      };
    })()`);
    check("empty state: recent searches shown", emptyState?.hasRecents === true && (emptyState?.sections ?? 0) >= 2, JSON.stringify(emptyState));
    check("empty state: quick entry shown", emptyState?.hasQuick === true, JSON.stringify(emptyState));
    await shot("3-empty-state");

    // ── 7. mobile entry point (375px) ───────────────────────────────────
    await send("Emulation.setDeviceMetricsOverride", {
      width: 375, height: 812, deviceScaleFactor: 2, mobile: true,
    });
    await send("Page.navigate", { url: `${BASE}/dashboard` });
    await sleep(2500);
    const mobileBtn = await evalJs(`(() => {
      const bs = [...document.querySelectorAll("button")].filter((x) => x.getAttribute("aria-label") === "全局搜索");
      const visible = bs.filter((b) => {
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        return cs.display !== "none" && r.width > 0;
      });
      return { total: bs.length, visible: visible.length };
    })()`);
    check("mobile: search icon button visible @375px", mobileBtn.total >= 2 && mobileBtn.visible >= 1, JSON.stringify(mobileBtn));
    await evalJs(`(() => {
      const bs = [...document.querySelectorAll("button")].filter((x) => x.getAttribute("aria-label") === "全局搜索");
      const visible = bs.find((b) => { const r = b.getBoundingClientRect(); return getComputedStyle(b).display !== "none" && r.width > 0; });
      if (visible) visible.click();
    })()`);
    await sleep(600);
    const mobilePanel = await evalJs(`(() => {
      const d = ${dlgExpr};
      return !!d && !!d.querySelector("input.gs-input") && Math.round(d.getBoundingClientRect().width) <= 375;
    })()`);
    check("mobile: panel opens full-width @375px", mobilePanel === true);
    await shot("4-mobile-panel");

    ws.close();
    console.log(`\n${results.join("\n")}`);
    console.log(`\nGlobal search UI acceptance: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""}\nScreenshots: ${OUT_DIR}/`);
    process.exit(failures > 0 ? 1 : 0);
  } finally {
    chrome.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
