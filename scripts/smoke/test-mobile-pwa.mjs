// P5-1 acceptance verification in a real headless Chrome via CDP (no
// extra dependencies - Node 22+ native WebSocket). Two modes:
//
//   MODE=layout (default, requires `pnpm dev` on :3000):
//     - 375×812 mobile viewport + touch emulation
//     - login as owner, visit core pages, assert no horizontal overflow
//     - assert mobile entry points exist (conv drawer, sources drawer,
//       camera upload, hamburger menu, chat-height)
//     - screenshots into /tmp/kai-mobile-shots/
//
//   MODE=pwa (requires production server, `pnpm build && pnpm start`):
//     - manifest + meta assertions
//     - service worker registers and controls the page
//     - offline (network emulation) still serves a previously loaded page
//
// Run: MODE=layout npx node scripts/smoke/test-mobile-pwa.mjs

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const MODE = process.env.MODE || "layout";
const PORT = 9333;
const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = "/tmp/kai-mobile-shots";
const PROFILE = "/tmp/kai-chrome-profile";

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

function main() {
  let failures = 0;
  const results = [];
  const check = (name, cond, detail = "") => {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  };

  return (async () => {
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
        const res = await send("Runtime.evaluate", {
          expression, returnByValue: true, awaitPromise: true,
        });
        return res.result?.result?.value;
      };
      const goto = async (url) => {
        await send("Page.navigate", { url });
        await sleep(2600); // SPA boot + data fetch
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
      await send("Emulation.setDeviceMetricsOverride", {
        width: 375, height: 812, deviceScaleFactor: 2, mobile: true,
      });
      await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

      // ── 0. login ────────────────────────────────────────────────────
      await goto(`${BASE}/login`);
      const overflowLogin = await evalJs(
        "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"
      );
      check("login page: no horizontal overflow @375px", overflowLogin === false, `overflow=${overflowLogin}`);
      await shot("0-login");

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

      const overflowOf = async () =>
        evalJs(
          "({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })"
        );

      // ── 1. core pages @375px ────────────────────────────────────────
      if (MODE === "layout") {
        for (const p of ["/dashboard", "/knowledge-base", "/chat", "/agent"]) {
          await goto(BASE + p);
          const o = await overflowOf();
          check(`page ${p}: no horizontal overflow @375px`, !o.overflow, `sw=${o.sw} cw=${o.cw}`);
          await shot(`1-${p.replace(/\//g, "_")}`);
        }

        // ── 2. chat page mobile entry points ───────────────────────────
        await goto(BASE + "/chat");
        const chatUi = await evalJs(`(() => {
          const q = (s) => !!document.querySelector(s);
          const visible = (s) => {
            const el = document.querySelector(s);
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return cs.display !== "none" && r.width > 0;
          };
          return {
            convDrawerBtn: q('[aria-label="会话列表"]') && visible('[aria-label="会话列表"]'),
            sourcesBtn: q('[aria-label="引用来源"]') && visible('[aria-label="引用来源"]'),
            chatHeight: q(".chat-height"),
            kbSelectorFlex: (() => {
              const el = document.querySelector('.chat-height [role="combobox"]');
              return !!el;
            })(),
            desktopSidebarHidden: !visible("aside.hidden.md\\\\:flex"),
            desktopSourcesHidden: !visible("aside.hidden.xl\\\\:flex"),
          };
        })()`);
        check("chat: mobile conversation drawer button visible @375px", chatUi.convDrawerBtn === true, JSON.stringify(chatUi));
        check("chat: mobile sources button visible @375px", chatUi.sourcesBtn === true, JSON.stringify(chatUi));
        check("chat: chat-height class applied", chatUi.chatHeight === true);
        check("chat: KB selector present in header", chatUi.kbSelectorFlex === true);
        check("chat: desktop sidebar hidden @375px", chatUi.desktopSidebarHidden === true);
        check("chat: desktop sources panel hidden @375px", chatUi.desktopSourcesHidden === true);
        await shot("2-chat-main");

        // open the conversation drawer (Sheet) and verify it renders
        await evalJs(`document.querySelector('[aria-label="会话列表"]').click()`);
        await sleep(600);
        const convSheet = await evalJs(`(() => {
          const sheet = document.querySelector('[data-state="open"][role="dialog"]');
          return { open: !!sheet, hasNewConv: !!sheet && !!sheet.querySelector("button"),
            width: sheet ? Math.round(sheet.getBoundingClientRect().width) : 0 };
        })()`);
        check("chat: conversation Sheet opens with content", convSheet.open === true && convSheet.width > 200, JSON.stringify(convSheet));
        await shot("2-chat-conv-sheet");

        // close drawer (Escape) and open sources drawer
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await sleep(500);
        await evalJs(`document.querySelector('[aria-label="引用来源"]').click()`);
        await sleep(600);
        const srcSheet = await evalJs(`(() => {
          const sheet = document.querySelector('[data-state="open"][role="dialog"]');
          return { open: !!sheet, width: sheet ? Math.round(sheet.getBoundingClientRect().width) : 0 };
        })()`);
        check("chat: sources Sheet opens", srcSheet.open === true && srcSheet.width > 200, JSON.stringify(srcSheet));
        await shot("2-chat-sources-sheet");

        // ── 3. mobile upload (camera entry) ────────────────────────────
        await goto(BASE + "/knowledge-base");
        const kbId = await evalJs(`(async () => {
          const d = await fetch("${BASE}/api/knowledge-base", { cache: "no-store" }).then((r) => r.json());
          return (d.kbs && d.kbs[0] && d.kbs[0].id) || null;
        })()`);
        check("kb: resolves a KB id for detail page", !!kbId, `${kbId}`);
        if (kbId) {
          await goto(`${BASE}/knowledge-base/${kbId}`);
          const cam = await evalJs(`(() => {
            const capture = document.querySelector('input[type="file"][capture="environment"]');
            const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("拍照上传"));
            if (!capture || !btn) return { capture: !!capture, btn: !!btn };
            const r = btn.getBoundingClientRect();
            const cs = getComputedStyle(btn);
            return { capture: !!capture, btn: !!btn, btnVisible: cs.display !== "none" && r.width > 0 };
          })()`);
          check("kb detail: camera upload input + button @375px", cam.capture === true && cam.btnVisible === true, JSON.stringify(cam));
          const o = await overflowOf();
          check(`kb detail page: no horizontal overflow @375px`, !o.overflow, `sw=${o.sw} cw=${o.cw}`);
          await shot("3-kb-detail");
        }
      }

      // ── 4. PWA mode (production server) ─────────────────────────────
      if (MODE === "pwa") {
        await goto(`${BASE}/chat`);
        const manifest = await evalJs(`(() => {
          const link = document.querySelector('link[rel="manifest"]');
          return link ? link.getAttribute("href") : null;
        })()`);
        check("pwa: manifest link present", manifest === "/manifest.webmanifest", `${manifest}`);

        // wait for SW to claim the page (SwRegister registers on load)
        let swState = null;
        for (let i = 0; i < 20; i++) {
          swState = await evalJs(`(async () => {
            if (!("serviceWorker" in navigator)) return { unsupported: true };
            const reg = await navigator.serviceWorker.getRegistration();
            return reg ? { active: !!reg.active, scope: reg.scope, controller: !!navigator.serviceWorker.controller } : null;
          })()`);
          if (swState && swState.active) break;
          await sleep(500);
        }
        check("pwa: service worker registered & active", swState?.active === true, JSON.stringify(swState));

        // load a page, then go offline and reload it
        await goto(`${BASE}/knowledge-base`);
        await send("Network.enable");
        await send("Network.emulateNetworkConditions", {
          offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
        });
        await send("Page.reload");
        await sleep(3000);
        const offline = await evalJs(`(() => ({
          url: location.pathname,
          title: document.title,
          hasShell: !!document.querySelector("header, aside, main"),
        }))()`);
        check("pwa: previously loaded page serves offline", offline.url === "/knowledge-base" && offline.hasShell === true, JSON.stringify(offline));
        await send("Network.emulateNetworkConditions", {
          offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
        });
        await shot("4-offline-reload");
      }

      ws.close();
      console.log(`\n${results.join("\n")}`);
      console.log(`\n${MODE} acceptance: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""}${MODE === "layout" ? `\nScreenshots: ${OUT_DIR}/` : ""}`);
      exitCode = failures > 0 ? 1 : 0;
      } finally {
        chrome.kill();
      }
      process.exit(exitCode);
  })();
}

main().catch((e) => { console.error(e); process.exit(1); });
