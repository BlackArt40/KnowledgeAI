// P5-5 acceptance verification in a real headless Chrome via CDP.
//   - three theme modes: system (follows the OS preference, live) / light / dark,
//     persisted in `kai-theme`, applied before hydration (no flash)
//   - theme switch cross-fade (`theme-transition` class appears then clears)
//   - high contrast mode: toggle + persistence + computed styles pass WCAG AA
//     (text >= 4.5:1, borders >= 3:1) in both light and dark
//   - workspace brand color: owner picks a color -> CSS variables change and
//     survive a reload (SSR injection); non-owners see a disabled picker
// Run: node scripts/smoke/test-theme-ui.mjs  (requires `pnpm dev` on :3000)

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PORT = 9778;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = "/tmp/kai-theme-shots";
const PROFILE = "/tmp/kai-chrome-theme";

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

// HSL channel triplet -> rgb, matching the CSS `--*` variable format.
// IIFE returning a helper object; inlined as `const H = ${HSL_JS}` so
// computed CSS vars can be measured directly inside the page.
const HSL_JS = `(() => {
  const parseHsl = (str) => {
    const m = String(str).trim().match(/(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)%\\s+(-?\\d+(?:\\.\\d+)?)%/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const hslToRgb = (h, s, l) => {
    h = (((h % 360) + 360) % 360) / 360; s /= 100; l /= 100;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
  };
  const parseRgb = (str) => {
    const m = String(str).match(/rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  };
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const varRgb = (name) => { const h = parseHsl(cssVar(name)); return h ? hslToRgb(...h) : null; };
  const elemRgb = (el, prop) => parseRgb(getComputedStyle(el).getPropertyValue(prop));
  const ratioBetween = (a, b) => (a && b ? ratio(a, b) : null);
  return { parseHsl, hslToRgb, parseRgb, ratio, cssVar, varRgb, elemRgb, ratioBetween };
})()`;

async function main() {
  let failures = 0;
  const results = [];
  const check = (name, cond, detail = "") => {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  };

  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);
  mkdirSync(OUT_DIR, { recursive: true });

  const chrome = spawn(CHROME, [
    "--headless=new",
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
    // Poll an evalJs expression until truthy (dev-mode first compiles are slow).
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

    // live-follow: flip the OS preference without reload
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
    const openToggle = await evalJs(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "切换主题");
      if (!b) return "no-toggle";
      b.click();
      return "clicked";
    })()`);
    await sleep(300);
    check("toggle: theme dropdown opens", openToggle === "clicked", openToggle);
    const pickMode = async (label) =>
      evalJs(`(() => {
        const btns = [...document.querySelectorAll("button")];
        const item = btns.find((b) => b.textContent.trim() === "${label}");
        if (!item) return "no-item";
        item.click();
        return "clicked";
      })()`);
    await pickMode("暗色");
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

    // reload keeps the explicit dark mode (pre-hydration script)
    await send("Page.navigate", { url: `${BASE}/dashboard` });
    await sleep(2500);
    st = await evalJs(`(() => ({ dark: document.documentElement.classList.contains("dark"), stored: localStorage.getItem("kai-theme") }))()`);
    check("dark: persists across reload", st.dark === true && st.stored === "dark", JSON.stringify(st));
    await shot("2-dark");

    // switch to light via the dropdown again
    await evalJs(`([...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "切换主题"))?.click()`);
    await sleep(300);
    await pickMode("亮色");
    await sleep(500);
    st = await evalJs(`(() => ({ dark: document.documentElement.classList.contains("dark"), stored: localStorage.getItem("kai-theme") }))()`);
    check("light: html.dark removed", st.dark === false, JSON.stringify(st));
    check("light: kai-theme=light persisted", st.stored === "light", String(st.stored));

    // back to system: the live OS listener applies again
    await evalJs(`([...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "切换主题"))?.click()`);
    await sleep(300);
    await pickMode("跟随系统");
    await sleep(500);
    st = await evalJs(`localStorage.getItem("kai-theme")`);
    check("system: kai-theme=system persisted", st === "system", String(st));
    await setMedia("dark");
    await sleep(600);
    st = await evalJs(`document.documentElement.classList.contains("dark")`);
    check("system: follows OS after explicit selection (dark)", st === true, JSON.stringify(st));
    await setMedia("light");
    await sleep(400);

    // ── 3. high contrast: settings toggle + WCAG AA computed ratios ─────
    console.log("\n── 3. 高对比度(WCAG AA) ──");
    await send("Page.navigate", { url: `${BASE}/settings?tab=appearance` });
    // Cold dev compile of /settings can take a while - during it the browser
    // still shows the old document. Wait for the appearance tab content (the
    // HC switch only exists inside it, so its presence proves the ?tab=
    // deep-link rendered the tab).
    const hcSwitchReady = await waitFor(`!!document.querySelector('button[role="switch"]')`, 60000);
    await sleep(300);
    const tabPresent = await evalJs(`[...document.querySelectorAll("button")].some((t) => t.textContent.includes("外观"))`);
    check("settings: 外观 tab present (深链 ?tab=appearance)", hcSwitchReady === true && tabPresent === true, `switch=${hcSwitchReady} tab=${tabPresent}`);
    const hcToggle = await evalJs(`(() => {
      const s = document.querySelector('button[role="switch"]');
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

    // WCAG AA checks (light HC): read computed styles of real elements
    const lightAA = await evalJs(`(() => {
      const H = ${HSL_JS};
      const body = document.body;
      const fg = H.elemRgb(body, "color");
      const bg = H.elemRgb(body, "background-color");
      const mutedEl = document.querySelector(".text-muted-foreground");
      const muted = mutedEl ? H.elemRgb(mutedEl, "color") : null;
      const header = document.querySelector("header");
      const border = header ? H.parseRgb(getComputedStyle(header).borderBottomColor) : null;
      const primary = H.varRgb("--primary");
      const primaryFg = H.varRgb("--primary-foreground");
      return {
        bodyText: H.ratioBetween(fg, bg),
        mutedText: H.ratioBetween(muted, bg),
        border: H.ratioBetween(border, bg),
        primaryButton: H.ratioBetween(primaryFg, primary),
        hcClass: document.documentElement.classList.contains("high-contrast"),
      };
    })()`);
    check("hc light: body text >= 4.5:1", lightAA.bodyText >= 4.5, `ratio=${lightAA.bodyText}`);
    check("hc light: muted text >= 4.5:1", lightAA.mutedText >= 4.5, `ratio=${lightAA.mutedText}`);
    check("hc light: border >= 3:1", lightAA.border >= 3, `ratio=${lightAA.border}`);
    check("hc light: primary button text >= 4.5:1", lightAA.primaryButton >= 4.5, `ratio=${lightAA.primaryButton}`);
    await shot("3-hc-light");

    // dark HC
    await setMedia("dark");
    await sleep(600);
    const darkAA = await evalJs(`(() => {
      const H = ${HSL_JS};
      const body = document.body;
      const fg = H.elemRgb(body, "color");
      const bg = H.elemRgb(body, "background-color");
      const mutedEl = document.querySelector(".text-muted-foreground");
      const muted = mutedEl ? H.elemRgb(mutedEl, "color") : null;
      const header = document.querySelector("header");
      const border = header ? H.parseRgb(getComputedStyle(header).borderBottomColor) : null;
      const primary = H.varRgb("--primary");
      const primaryFg = H.varRgb("--primary-foreground");
      return {
        bodyText: H.ratioBetween(fg, bg),
        mutedText: H.ratioBetween(muted, bg),
        border: H.ratioBetween(border, bg),
        primaryButton: H.ratioBetween(primaryFg, primary),
        dark: document.documentElement.classList.contains("dark"),
        hcClass: document.documentElement.classList.contains("high-contrast"),
      };
    })()`);
    check("hc dark: dark+hc both active", darkAA.dark === true && darkAA.hcClass === true, JSON.stringify(darkAA));
    check("hc dark: body text >= 4.5:1", darkAA.bodyText >= 4.5, `ratio=${darkAA.bodyText}`);
    check("hc dark: muted text >= 4.5:1", darkAA.mutedText >= 4.5, `ratio=${darkAA.mutedText}`);
    check("hc dark: border >= 3:1", darkAA.border >= 3, `ratio=${darkAA.border}`);
    check("hc dark: primary button text >= 4.5:1", darkAA.primaryButton >= 4.5, `ratio=${darkAA.primaryButton}`);
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

    // ── 4. workspace brand color (owner) ────────────────────────────────
    console.log("\n── 4. 品牌色(owner) ──");
    // React serializes inline backgroundColor to rgb - match the emerald swatch
    const pickSwatch = await waitFor(`(() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        b.getAttribute("style") && b.getAttribute("style").includes("rgb(4, 120, 87)"));
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

    // reload -> SSR re-injects (server reads the workspace store)
    await send("Page.navigate", { url: `${BASE}/dashboard` });
    await sleep(2500);
    const afterReload = await evalJs(`(() => {
      const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
      return { primary, hasTag: !!document.getElementById("kai-brand-style") };
    })()`);
    check("brand: survives reload via SSR injection", afterReload.primary === "158 64% 33%" && afterReload.hasTag === true, JSON.stringify(afterReload));

    // ── 5. brand color picker is owner-only ─────────────────────────────
    console.log("\n── 5. 品牌色权限(viewer) ──");
    const viewerToken = await login("viewer@knowledgeai.dev");
    check("login: viewer token obtained", !!viewerToken);
    await send("Page.navigate", { url: `${BASE}/settings?tab=appearance` });
    await waitFor(`document.querySelectorAll("button").length > 10`);
    await sleep(800);
    const viewerState = await evalJs(`(() => {
      const swatches = [...document.querySelectorAll("button")].filter((b) =>
        b.getAttribute("style") && /^background-color: rgb/.test(b.getAttribute("style")));
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
