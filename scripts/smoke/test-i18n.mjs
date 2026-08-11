// P5-4 acceptance verification in a real headless Chrome via CDP.
//   - default UI renders in Chinese (zh)
//   - Globe switcher flips the app to English immediately (no reload)
//   - the preference persists in localStorage + `kai-locale` cookie + <html lang>
//   - after a full reload the app still renders in English
// Run: node scripts/smoke/test-i18n.mjs  (requires `pnpm dev` on :3000)

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PORT = 9777;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = "/tmp/kai-i18n-shots";
const PROFILE = "/tmp/kai-chrome-i18n";

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
    const shot = async (name) => {
      try {
        const res = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(res.result.data, "base64"));
        return `${OUT_DIR}/${name}.png`;
      } catch { return "screenshot failed"; }
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
    await send("Page.navigate", { url: `${BASE}/login` });
    await sleep(2000);

    // login
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

    // reset any persisted locale so the default-zh assertions are deterministic
    await evalJs(`localStorage.removeItem("kai-locale"); document.cookie = "kai-locale=; path=/; max-age=0";`);

    // ── 1. default zh rendering ─────────────────────────────────────────
    await send("Page.navigate", { url: `${BASE}/dashboard` });
    await sleep(3000);
    const zhState = await evalJs(`(() => {
      const body = document.body.innerText;
      const lang = document.documentElement.lang;
      const stored = localStorage.getItem("kai-locale");
      return { hasZhNav: body.includes("仪表盘") && body.includes("知识库"), lang, stored };
    })()`);
    check("default: UI renders in Chinese (仪表盘/知识库)", zhState.hasZhNav === true, JSON.stringify(zhState));
    check("default: <html lang> is zh-CN", zhState.lang === "zh-CN", zhState.lang);

    // ── 2. switch to English via the Globe dropdown ─────────────────────
    const switched = await evalJs(`(() => {
      const globe = [...document.querySelectorAll("button")].find((b) =>
        ["切换语言", "Switch language"].includes(b.getAttribute("aria-label")));
      if (!globe) return "no-globe";
      globe.click();
      return "clicked";
    })()`);
    await sleep(400);
    const pickedEn = await evalJs(`(() => {
      const btns = [...document.querySelectorAll("button")];
      const en = btns.find((b) => b.textContent.trim() === "English");
      if (!en) return "no-en-btn";
      en.click();
      return "clicked";
    })()`);
    check("switch: Globe dropdown offers English", pickedEn === "clicked", pickedEn);
    await sleep(500);
    const enState = await evalJs(`(() => {
      const body = document.body.innerText;
      return {
        hasEnNav: body.includes("Dashboard") && body.includes("Knowledge Base"),
        lang: document.documentElement.lang,
        stored: localStorage.getItem("kai-locale"),
        cookie: document.cookie.includes("kai-locale=en"),
      };
    })()`);
    check("switch: UI flips to English immediately", enState.hasEnNav === true, JSON.stringify(enState));
    check("switch: localStorage kai-locale=en", enState.stored === "en", enState.stored);
    check("switch: kai-locale cookie set", enState.cookie === true, "");
    check("switch: <html lang> becomes en", enState.lang === "en", enState.lang);
    await shot("1-english");

    // ── 3. persistence across a full reload ─────────────────────────────
    await send("Page.reload");
    await sleep(3000);
    const afterReload = await evalJs(`(() => {
      const body = document.body.innerText;
      return {
        stillEn: body.includes("Dashboard") && !body.includes("仪表盘"),
        lang: document.documentElement.lang,
      };
    })()`);
    check("persist: English survives a full reload", afterReload.stillEn === true && afterReload.lang === "en", JSON.stringify(afterReload));
    await shot("2-after-reload");

    // ── 4. switch back to Chinese ───────────────────────────────────────
    await evalJs(`(() => {
      const globe = [...document.querySelectorAll("button")].find((b) =>
        ["切换语言", "Switch language"].includes(b.getAttribute("aria-label")));
      if (globe) globe.click();
    })()`);
    await sleep(300);
    await evalJs(`(() => {
      const btns = [...document.querySelectorAll("button")];
      const zh = btns.find((b) => b.textContent.trim() === "中文");
      if (zh) zh.click();
    })()`);
    await sleep(400);
    const zhBack = await evalJs(`(() => ({
      hasZhNav: document.body.innerText.includes("仪表盘"),
      stored: localStorage.getItem("kai-locale"),
    }))()`);
    check("switch: back to Chinese works", zhBack.hasZhNav === true && zhBack.stored === "zh-CN", JSON.stringify(zhBack));

    // ── 5. settings language picker persists to the user profile ────────
    // reset the client locale to zh so picking English is a real change
    await evalJs(`localStorage.setItem("kai-locale", "zh-CN"); document.cookie = "kai-locale=zh-CN; path=/; max-age=31536000";`);
    await send("Page.navigate", { url: `${BASE}/settings?tab=profile` });
    await sleep(3000);
    const profileLang = await evalJs(`(() => {
      const selects = [...document.querySelectorAll("button")];
      const trigger = selects.find((b) => b.getAttribute("role") === "combobox");
      return trigger ? trigger.textContent.trim() : "no-select";
    })()`);
    check("settings: language picker present in profile", profileLang !== "no-select", profileLang);
    // switch to en via the profile picker (persists to /api/auth/me)
    const pickerEn = await evalJs(`(async () => {
      const trigger = [...document.querySelectorAll("button")].find((b) => b.getAttribute("role") === "combobox");
      if (!trigger) return "no-trigger";
      trigger.click();
      await new Promise((r) => setTimeout(r, 300));
      const items = [...document.querySelectorAll("[role=option]")];
      const en = items.find((i) => i.textContent.trim() === "English");
      if (!en) return "no-option";
      en.click();
      await new Promise((r) => setTimeout(r, 600));
      const me = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json());
      return me.user?.locale ?? "none";
    })()`);
    check("settings: locale persisted to user profile", pickerEn === "en", pickerEn);
    // revert
    await evalJs(`(async () => {
      await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: "zh-CN" }),
      });
    })()`);

    ws.close();
    console.log(`\n${results.join("\n")}`);
    console.log(`\nI18n UI acceptance: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""}\nScreenshots: ${OUT_DIR}/`);
    process.exit(failures > 0 ? 1 : 0);
  } finally {
    chrome.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
