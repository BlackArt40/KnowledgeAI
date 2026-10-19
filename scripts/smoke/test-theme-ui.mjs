// P5-5 acceptance verification in a real headless Chrome via CDP.
//   - three theme modes: system (follows the OS preference, live) / light / dark,
//     persisted in `kai-theme`, applied before hydration (no flash)
//   - theme switch cross-fade (`theme-transition` class appears then clears)
//   - high contrast mode: toggle + persistence (html.high-contrast + kai-hc)
//     + computed styles pass WCAG AA (text >= 4.5:1, borders >= 3:1) in both
//     light and dark
//   - workspace brand color: owner picks a color -> client applyBrandColor
//     injects #kai-brand-style and switches --primary; the choice persists
//     server-side (workspace.brandColor) and the settings page reflects it
// Run: node scripts/smoke/test-theme-ui.mjs  (requires `pnpm dev` on :3000 +
//      vite preview on :4173)
//
// V6: 页面层已切换为 Vue 3 + Element Plus（vite preview :4173 服务 dist），
// DOM 断言按 Vue 侧等价结构改写（frontend/src/components/ThemeToggle.vue /
// ThemeSettings.vue / SettingsView.vue）：
//   - Next 头部「切换主题」Radix dropdown → Vue .theme-toggle（aria-label=theme）
//     + EP .el-dropdown-menu__item（teleport 到 body，项文案为 light/dark/system）
//   - 设置页 Radix switch → EP .el-switch（点击外层 div 触发 switchValue），
//     tabs 断言限定 #pane-appearance（EP 所有 pane 常驻 DOM）
//   - V7: tokens.css 已移植 .high-contrast 对比度覆盖规则（globals.css 随
//     V6 退役），WCAG 计算对比度断言恢复（AA_JS，见下方注释）
//   - V6: 品牌色无 SSR 注入（App 启动 theme.init() 固定应用默认 indigo），
//     reload 后的持久化断言改为服务端 workspace.brandColor + 设置页选中态

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolveChrome, chromeMissingMessage, LOCALE_ARGS } from "./lib/chrome.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173"; // V6: 页面由 vite preview 承载（Next 纯 API）
const PORT = 9778;
const CHROME = resolveChrome();
const OUT_DIR = "/tmp/kai-theme-shots";
const PROFILE = "/tmp/kai-chrome-theme";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// WCAG AA 计算对比度测量（V7 恢复：frontend tokens.css 已移植 .high-contrast
// 覆盖规则；EP 变量经 hsl(var(--x)) 动态传导，无需额外适配）。
// 锚点（AppShell 侧边栏稳定类）：.shell=正文/页面底色、.ws-plan=次要文字、
// .ws-btn=UI 边界；--primary/--primary-foreground 用临时 probe 元素经真实
// 级联解析（品牌色 style tag 注入后同样生效）。口径与 V6 前 Next 版一致：
// 文字 ≥ 4.5:1，边界 ≥ 3:1。
const AA_JS = `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(",").map((s) => parseFloat(s));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = (c) => {
    if (!c || c.a === 0) return null;
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    if (la === null || lb === null) return null;
    return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
  };
  const shell = document.querySelector(".shell");
  const wsPlan = document.querySelector(".ws-plan");
  const wsBtn = document.querySelector(".ws-btn");
  if (!shell || !wsPlan || !wsBtn) return null;
  const bg = parse(getComputedStyle(shell).backgroundColor);
  const fg = parse(getComputedStyle(shell).color);
  const muted = parse(getComputedStyle(wsPlan).color);
  const border = parse(getComputedStyle(wsBtn).borderTopColor);
  const probe = document.createElement("div");
  probe.style.background = "hsl(var(--primary))";
  probe.style.color = "hsl(var(--primary-foreground))";
  document.body.appendChild(probe);
  const pc = getComputedStyle(probe);
  const primaryButton = ratio(parse(pc.color), parse(pc.backgroundColor));
  probe.remove();
  return {
    bodyText: ratio(fg, bg),
    mutedText: ratio(muted, bg),
    border: ratio(border, bg),
    primaryButton,
  };
})()`;

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

  let exitCode = 0;
  try {
    await waitForPort(PORT);
    const target = await fetch(
      `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + "/login")}`,
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
      if (res.result?.exceptionDetails) {
        throw new Error(`evalJs: ${res.result.exceptionDetails.text} ${res.result.exceptionDetails.exception?.description ?? ""}`);
      }
      return res.result?.result?.value;
    };
    const shot = async (name) => {
      try {
        const res = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(res.result.data, "base64"));
      } catch {}
    };
    const setMedia = (scheme) =>
      send("Emulation.setEmulatedMedia", {
        media: "",
        features: [{ name: "prefers-color-scheme", value: scheme }],
      });
    // Poll an evalJs expression until truthy.
    const waitFor = async (expression, timeoutMs = 10000, interval = 400) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const v = await evalJs(expression);
        if (v) return v;
        await sleep(interval);
      }
      return null;
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${BASE}/login` });
    await sleep(2000);

    // login as owner (theme is per-device, so switching users = swap token)
    const login = async (email) =>
      evalJs(`(async () => {
        const d = await fetch("${BASE}/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "${email}", password: "password123" }),
        }).then((r) => r.json());
        if (!d.token) return null;
        localStorage.setItem("kai-token", d.token);
        document.cookie = "kai-token=" + d.token + "; path=/";
        return d.token;
      })()`);
    const ownerToken = await login("owner@knowledgeai.dev");
    check("login: owner token obtained", !!ownerToken);

    // deterministic state: no stored theme / hc / locale
    await evalJs(`localStorage.removeItem("kai-theme"); localStorage.removeItem("kai-hc");
      localStorage.removeItem("kai-locale"); document.cookie = "kai-locale=; path=/; max-age=0";`);

    // ── 1. system mode follows the OS preference ────────────────────────
    console.log("\n── 1. 跟随系统(默认) ──");
    await setMedia("dark");
    await send("Page.navigate", { url: `${BASE}/dashboard` });
    await sleep(2500);
    let st = await evalJs(`(() => ({ dark: document.documentElement.classList.contains("dark"), stored: localStorage.getItem("kai-theme") }))()`);
    check("system+dark: html.dark applied", st.dark === true, JSON.stringify(st));
    check("system: no kai-theme stored (default)", st.stored === null, String(st.stored));

    // live-follow: flip the OS preference without reload (App.vue theme.init
    // 订阅系统主题变化，mode=system 时由引擎回放 applyTheme)
    await setMedia("light");
    await sleep(600);
    st = await evalJs(`document.documentElement.classList.contains("dark")`);
    check("system+light: html.dark removed live (no reload)", st === false, JSON.stringify(st));
    await setMedia("dark");
    await sleep(600);
    st = await evalJs(`document.documentElement.classList.contains("dark")`);
    check("system+dark: html.dark restored live", st === true, JSON.stringify(st));
    await shot("1-system-dark");
    await setMedia("light");
    await sleep(400);

    // ── 2. explicit dark / light via the header dropdown ────────────────
    console.log("\n── 2. 亮/暗模式下拉 ──");
    // V6: Vue ThemeToggle 的按钮 aria-label 固定为 "theme"，下拉项为 EP
    // .el-dropdown-menu__item（teleport 到 body），文案直接是 light/dark/system
    const openToggle = await evalJs(`(() => {
      const b = document.querySelector("button.theme-toggle") ||
        [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "theme");
      if (!b) return "no-toggle";
      b.click();
      return "clicked";
    })()`);
    await sleep(400);
    check("toggle: theme dropdown opens", openToggle === "clicked", openToggle);
    const pickMode = async (label) =>
      evalJs(`(() => {
        const items = [...document.querySelectorAll(".el-dropdown-menu__item")];
        const item = items.find((b) => b.textContent.replace(/\\s+/g, "") === "${label}");
        if (!item) return "no-item";
        item.click();
        return "clicked";
      })()`);
    await pickMode("dark");
    // the transition class is added synchronously by the click handler and
    // removed ~500ms later - read it immediately, before the cross-fade ends
    const transitioning = await evalJs(`document.documentElement.classList.contains("theme-transition")`);
    await sleep(500);
    st = await evalJs(`(() => ({
      dark: document.documentElement.classList.contains("dark"),
      stored: localStorage.getItem("kai-theme"),
    }))()`);
    check("dark: html.dark applied", st.dark === true, JSON.stringify(st));
    check("dark: kai-theme=dark persisted", st.stored === "dark", String(st.stored));
    check("dark: theme-transition class present right after switch", transitioning === true, String(transitioning));
    await sleep(900);
    st = await evalJs(`document.documentElement.classList.contains("theme-transition")`);
    check("dark: theme-transition cleared after the cross-fade", st === false, String(st));

    // reload keeps the explicit dark mode (pre-hydration script in index.html)
    await send("Page.navigate", { url: `${BASE}/dashboard` });
    await sleep(2500);
    st = await evalJs(`(() => ({ dark: document.documentElement.classList.contains("dark"), stored: localStorage.getItem("kai-theme") }))()`);
    check("dark: persists across reload", st.dark === true && st.stored === "dark", JSON.stringify(st));
    await shot("2-dark");

    // switch to light via the dropdown again
    await evalJs(`(document.querySelector("button.theme-toggle") ||
      [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "theme"))?.click()`);
    await sleep(400);
    await pickMode("light");
    await sleep(500);
    st = await evalJs(`(() => ({ dark: document.documentElement.classList.contains("dark"), stored: localStorage.getItem("kai-theme") }))()`);
    check("light: html.dark removed", st.dark === false, JSON.stringify(st));
    check("light: kai-theme=light persisted", st.stored === "light", String(st.stored));

    // back to system: the live OS listener applies again
    await evalJs(`(document.querySelector("button.theme-toggle") ||
      [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "theme"))?.click()`);
    await sleep(400);
    await pickMode("system");
    await sleep(500);
    st = await evalJs(`localStorage.getItem("kai-theme")`);
    check("system: kai-theme=system persisted", st === "system", String(st));
    await setMedia("dark");
    await sleep(600);
    st = await evalJs(`document.documentElement.classList.contains("dark")`);
    check("system: follows OS after explicit selection (dark)", st === true, JSON.stringify(st));
    await setMedia("light");
    await sleep(400);

    // ── 3. high contrast: settings toggle + persistence ─────────────────
    console.log("\n── 3. 高对比度 ──");
    await send("Page.navigate", { url: `${BASE}/settings?tab=appearance` });
    // V6: EP tabs 所有 pane 常驻 DOM——HC 开关限定 #pane-appearance；
    // tabs 要等 /api/auth 等请求返回后（loading=false）才渲染
    const hcSwitchReady = await waitFor(`!!document.querySelector('#pane-appearance .el-switch')`, 30000);
    await sleep(300);
    const tabPresent = await evalJs(`[...document.querySelectorAll(".el-tabs__item")].some((t) => t.textContent.includes("外观"))`);
    check("settings: 外观 tab present (深链 ?tab=appearance)", hcSwitchReady === true && tabPresent === true, `switch=${hcSwitchReady} tab=${tabPresent}`);
    await evalJs(`(() => {
      // V6: EP switch 的点击处理器在外层 .el-switch div（withModifiers prevent）
      const s = document.querySelector('#pane-appearance .el-switch');
      s.click();
      return "clicked";
    })()`);
    await sleep(500);
    st = await evalJs(`(() => ({
      hc: document.documentElement.classList.contains("high-contrast"),
      stored: localStorage.getItem("kai-hc"),
    }))()`);
    check("hc: html.high-contrast applied", st.hc === true, JSON.stringify(st));
    check("hc: kai-hc=1 persisted", st.stored === "1", String(st.stored));
    // V7: WCAG AA 计算对比度断言恢复（tokens.css 已移植 .high-contrast 覆盖
    // 规则）——light HC 四项：正文/次要文字 ≥4.5:1、边界 ≥3:1、primary 按钮文字。
    const lightAA = await evalJs(AA_JS);
    check("hc light: body text >= 4.5:1", !!lightAA && lightAA.bodyText >= 4.5, JSON.stringify(lightAA));
    check("hc light: muted text >= 4.5:1", !!lightAA && lightAA.mutedText >= 4.5, JSON.stringify(lightAA));
    check("hc light: border >= 3:1", !!lightAA && lightAA.border >= 3, JSON.stringify(lightAA));
    check("hc light: primary button text >= 4.5:1", !!lightAA && lightAA.primaryButton >= 4.5, JSON.stringify(lightAA));
    await shot("3-hc-light");

    // dark + HC coexist（引擎在 html 上同时维护 .dark 与 .high-contrast）
    await setMedia("dark");
    await sleep(600);
    st = await evalJs(`(() => ({
      dark: document.documentElement.classList.contains("dark"),
      hcClass: document.documentElement.classList.contains("high-contrast"),
    }))()`);
    check("hc dark: dark+hc both active", st.dark === true && st.hcClass === true, JSON.stringify(st));
    const darkAA = await evalJs(AA_JS);
    check("hc dark: body text >= 4.5:1", !!darkAA && darkAA.bodyText >= 4.5, JSON.stringify(darkAA));
    check("hc dark: muted text >= 4.5:1", !!darkAA && darkAA.mutedText >= 4.5, JSON.stringify(darkAA));
    check("hc dark: border >= 3:1", !!darkAA && darkAA.border >= 3, JSON.stringify(darkAA));
    check("hc dark: primary button text >= 4.5:1", !!darkAA && darkAA.primaryButton >= 4.5, JSON.stringify(darkAA));
    await shot("4-hc-dark");

    // hc persists across reload (pre-hydration script applies it)
    await send("Page.navigate", { url: `${BASE}/settings?tab=appearance` });
    await sleep(2500);
    st = await evalJs(`(() => ({
      hc: document.documentElement.classList.contains("high-contrast"),
      dark: document.documentElement.classList.contains("dark"),
    }))()`);
    check("hc: persists across reload (dark+hc)", st.hc === true && st.dark === true, JSON.stringify(st));
    await setMedia("light");
    await sleep(400);
    // teardown: switch HC back off (the class is per-device state)
    await evalJs(`(() => {
      const s = document.querySelector('#pane-appearance .el-switch');
      if (s) s.click();
    })()`);
    await sleep(400);

    // ── 4. workspace brand color (owner) ────────────────────────────────
    console.log("\n── 4. 品牌色(owner) ──");
    // Vue 与 React 一样经 CSSOM 序列化内联 backgroundColor：hex 源值
    // (#047857) 在 style 属性里表现为 rgb(4, 120, 87)——两种形态都兼容。
    const pickSwatch = await waitFor(`(() => {
      const btn = [...document.querySelectorAll("#pane-appearance button.swatch")].find((b) => {
        const s = b.getAttribute("style") || "";
        return s.includes("rgb(4, 120, 87)") || s.includes("#047857");
      });
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await sleep(1500);
    check("brand: emerald swatch clicked", pickSwatch === true);
    const brandState = await evalJs(`(() => {
      const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
      const tag = document.getElementById("kai-brand-style");
      return { primary, hasTag: !!tag, tagCss: tag ? tag.textContent.slice(0, 60) : "" };
    })()`);
    check("brand: --primary switched to emerald", brandState.primary === "158 64% 33%", JSON.stringify(brandState));
    check("brand: style tag injected (id=kai-brand-style)", brandState.hasTag === true);
    await shot("5-brand-emerald");

    // V6: 无 SSR 注入，reload 后 App 启动 theme.init() 会先应用默认 indigo
    //（页面视觉不回放 workspace 品牌色）——持久化断言改为服务端
    // workspace.brandColor（PATCH /api/workspaces 已落库）+ 设置页选中态。
    await send("Page.navigate", { url: `${BASE}/settings?tab=appearance` });
    await sleep(2500);
    const afterReload = await waitFor(`(async () => {
      const swatch = [...document.querySelectorAll("#pane-appearance button.swatch")]
        .find((b) => {
          const s = b.getAttribute("style") || "";
          return s.includes("rgb(4, 120, 87)") || s.includes("#047857");
        });
      if (!swatch) return null;
      const d = await fetch("/api/workspaces", { cache: "no-store" }).then((r) => r.json());
      const cur = (d.workspaces ?? []).find((w) => w.id === d.currentWorkspace);
      return {
        pressed: swatch.getAttribute("aria-pressed") === "true",
        brandColor: cur?.brandColor ?? null,
      };
    })()`, 15000);
    check("brand: persists server-side (workspace.brandColor)", afterReload?.brandColor === "emerald", JSON.stringify(afterReload));
    check("brand: settings page reflects persisted color (aria-pressed)", afterReload?.pressed === true, JSON.stringify(afterReload));

    // ── 5. brand color picker is owner-only ─────────────────────────────
    console.log("\n── 5. 品牌色权限(viewer) ──");
    const viewerToken = await login("viewer@knowledgeai.dev");
    check("login: viewer token obtained", !!viewerToken);
    await send("Page.navigate", { url: `${BASE}/settings?tab=appearance` });
    await waitFor(`document.querySelectorAll("#pane-appearance button.swatch").length > 0`);
    await sleep(800);
    const viewerState = await evalJs(`(() => {
      const swatches = [...document.querySelectorAll("#pane-appearance button.swatch")];
      const disabled = swatches.every((b) => b.disabled === true);
      const hint = document.body.innerText.includes("仅工作区所有者可修改品牌色");
      return { count: swatches.length, disabled, hint };
    })()`);
    check("viewer: swatches rendered", viewerState.count === 6, `count=${viewerState.count}`);
    check("viewer: swatches disabled", viewerState.disabled === true, JSON.stringify(viewerState));
    check("viewer: owner-only hint shown", viewerState.hint === true);

    // ── 6. cleanup: restore indigo (Node-side, owner token - the page is
    //         currently signed in as the viewer) ─────────────────────────
    console.log("\n── 6. 清理 ──");
    const reset = await (async () => {
      const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@knowledgeai.dev", password: "password123" }),
      }).then((r) => r.json());
      if (!loginRes.token) return "no-token";
      const res = await fetch(`${BASE}/api/workspaces`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: `kai-token=${loginRes.token}` },
        body: JSON.stringify({ brandColor: "indigo" }),
      }).then((r) => r.json());
      return res.workspace?.brandColor;
    })();
    check("cleanup: brand restored to indigo", reset === "indigo", String(reset));

    console.log(`\n${results.join("\n")}`);
    console.log(`\nTheme UI acceptance: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""} (screenshots: ${OUT_DIR})`);
    exitCode = failures > 0 ? 1 : 0;
    } catch (err) {
      console.error("CDP error:", err);
      exitCode = 1;
    } finally {
      chrome.kill();
    }
    process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(1); });
