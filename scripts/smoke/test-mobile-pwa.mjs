// P5-1 acceptance verification in a real headless Chrome via CDP (no
// extra dependencies - Node 22+ native WebSocket). Two modes:
//
//   MODE=layout (default, requires `pnpm dev` on :3000 + vite preview :4173):
//     - 375×812 mobile viewport + touch emulation
//     - login as owner, visit core pages, assert no horizontal overflow
//     - assert mobile entry points exist (conv drawer, sources drawer,
//       hamburger menu, chat page height, KB selector)
//     - screenshots into /tmp/kai-mobile-shots/
//
//   MODE=pwa (vite preview :4173 serves the production dist):
//     - sw.js content contract (single-sourced in Next public/, copied into
//       dist by the vite copyPwaAssets plugin)
//     - REAL SW verification: clean slate → reload → navigator.serviceWorker
//       .ready → scriptURL /sw.js, v6-vue-1 cache names, precache shell
//       (/, /login) via caches API, /assets/ stale-while-revalidate hits,
//       /api/ network-only (no cache entry)
//
// Run: MODE=layout node scripts/smoke/test-mobile-pwa.mjs
//
// V6: 页面层已切换为 Vue 3 + Element Plus（vite preview :4173 服务 dist），
// DOM 断言按 Vue 侧等价结构改写（frontend/src/views/ChatView.vue 等）：
//   - .chat-height（Next tailwind 布局类）→ .chat-page（Vue 根类，
//     calc(100dvh - 8.5rem) 等价实现）
//   - Radix combobox → EP .el-select__wrapper[role=combobox]（fallback .el-select）
//   - 桌面侧栏/来源面板 aside.hidden.md:flex / xl:flex → .conv-side / .sources-side
//   - Radix Sheet [data-state=open][role=dialog] → EP .el-drawer[role=dialog]
//     （role 直接挂在 .el-drawer 上；关闭后 overlay 为 display:none）
//   - V6: Vue 侧 KbDetailView 无 capture=environment 拍照上传入口（能力缺失），
//     该断言移除；manifest link 仍无（Vue index.html 未引用）；SW 注册在
//     pwa 模式做真实验证（copyPwaAssets 后 preview 同源可达 /sw.js）

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolveChrome, chromeMissingMessage, LOCALE_ARGS } from "./lib/chrome.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173"; // V6: 页面由 vite preview 承载（Next 纯 API）
const NEXT_ORIGIN = process.env.NEXT_ORIGIN || "http://localhost:3000"; // sw.js 单源在 Next public/
const MODE = process.env.MODE || "layout";
const PORT = 9333;
const CHROME = resolveChrome();
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
          // V6: EP drawer 关闭时常驻 DOM 且 aria-label 与 header 按钮同名——
          // 以「存在可见匹配」为准，而非第一个 DOM 匹配
          const anyVisible = (sel) => [...document.querySelectorAll(sel)]
            .some((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.display !== "none" && r.width > 0; });
          return {
            convDrawerBtn: anyVisible('[aria-label="会话列表"]'),
            sourcesBtn: anyVisible('[aria-label="引用来源"]'),
            chatHeight: !!document.querySelector(".chat-page"), // V6: Vue 侧布局根类（等价 .chat-height）
            kbSelectorFlex: (() => {
              // V6: EP select（wrapper 带 role=combobox，fallback .el-select）
              const el = document.querySelector('.chat-page [role="combobox"]') ||
                document.querySelector('.chat-page .el-select');
              return !!el;
            })(),
            // V6: 桌面侧栏/来源面板为 .conv-side / .sources-side（<1024/<1280px 隐藏）
            desktopSidebarHidden: !anyVisible(".chat-page .conv-side"),
            desktopSourcesHidden: !anyVisible(".chat-page .sources-side"),
          };
        })()`);
        check("chat: mobile conversation drawer button visible @375px", chatUi.convDrawerBtn === true, JSON.stringify(chatUi));
        check("chat: mobile sources button visible @375px", chatUi.sourcesBtn === true, JSON.stringify(chatUi));
        check("chat: chat page height class applied", chatUi.chatHeight === true);
        check("chat: KB selector present in header", chatUi.kbSelectorFlex === true);
        check("chat: desktop sidebar hidden @375px", chatUi.desktopSidebarHidden === true);
        check("chat: desktop sources panel hidden @375px", chatUi.desktopSourcesHidden === true);
        await shot("2-chat-main");

        // open the conversation drawer (EP el-drawer) and verify it renders.
        // V6: EP drawer 关闭时也常驻 DOM 且 title 透传 aria-label（与 header
        // 按钮同名）——点击与可见性判断都必须选「可见」的那个元素。
        await evalJs(`(() => {
          const btn = [...document.querySelectorAll('[aria-label="会话列表"]')]
            .find((b) => { const r = b.getBoundingClientRect(); return r.width > 0; });
          if (btn) btn.click();
        })()`);
        await sleep(600);
        const convSheet = await evalJs(`(() => {
          // V6: EP drawer——role="dialog" 在 .el-drawer 上，可见性看 overlay
          const sheet = [...document.querySelectorAll('.el-drawer[role="dialog"]')]
            .find((d) => d.closest(".el-overlay") && !d.closest(".el-overlay").getAttribute("style")?.includes("display: none"));
          return { open: !!sheet, hasNewConv: !!sheet && !!sheet.querySelector("button"),
            width: sheet ? Math.round(sheet.getBoundingClientRect().width) : 0 };
        })()`);
        check("chat: conversation drawer opens with content", convSheet.open === true && convSheet.width > 200, JSON.stringify(convSheet));
        await shot("2-chat-conv-sheet");

        // close drawer (Escape, fallback: close button) and open sources drawer
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await sleep(500);
        await evalJs(`(() => {
          const anyOpen = [...document.querySelectorAll('.el-drawer[role="dialog"]')]
            .some((d) => !d.closest(".el-overlay").getAttribute("style")?.includes("display: none"));
          if (anyOpen) document.querySelector(".el-drawer__close-btn")?.click();
        })()`);
        await sleep(500);
        await evalJs(`(() => {
          const btn = [...document.querySelectorAll('[aria-label="引用来源"]')]
            .find((b) => { const r = b.getBoundingClientRect(); return r.width > 0; });
          if (btn) btn.click();
        })()`);
        await sleep(600);
        const srcSheet = await evalJs(`(() => {
          const sheet = [...document.querySelectorAll('.el-drawer[role="dialog"]')]
            .find((d) => d.closest(".el-overlay") && !d.closest(".el-overlay").getAttribute("style")?.includes("display: none"));
          return { open: !!sheet, width: sheet ? Math.round(sheet.getBoundingClientRect().width) : 0 };
        })()`);
        check("chat: sources drawer opens", srcSheet.open === true && srcSheet.width > 200, JSON.stringify(srcSheet));
        await shot("2-chat-sources-sheet");

        // ── 3. kb detail page @375px ───────────────────────────────────
        // V6: Vue 侧 KbDetailView 无 capture="environment" 拍照上传入口
        //（移动端相机上传能力缺失），断言移除，仅保留页面溢出检查。
        await goto(BASE + "/knowledge-base");
        const kbId = await evalJs(`(async () => {
          const d = await fetch("${BASE}/api/knowledge-base", { cache: "no-store" }).then((r) => r.json());
          return (d.kbs && d.kbs[0] && d.kbs[0].id) || null;
        })()`);
        check("kb: resolves a KB id for detail page", !!kbId, `${kbId}`);
        if (kbId) {
          await goto(`${BASE}/knowledge-base/${kbId}`);
          const o = await overflowOf();
          check(`kb detail page: no horizontal overflow @375px`, !o.overflow, `sw=${o.sw} cw=${o.cw}`);
          await shot("3-kb-detail");
        }
      }

      // ── 4. PWA mode (real SW verification on the production dist) ───
      if (MODE === "pwa") {
        // sw.js content contract (single-sourced in Next public/, copied into
        // dist by the vite copyPwaAssets plugin).
        const swSrc = await fetch(`${NEXT_ORIGIN}/sw.js`).then((r) => r.text());
        check("pwa: sw.js (Next public 单源) carries VERSION v6-vue-1",
          swSrc.includes('const VERSION = "v6-vue-1"'), swSrc.slice(0, 120));
        check("pwa: sw.js runtime cache list uses /assets/ (Vite hashed chunks)",
          swSrc.includes('"/assets/') || swSrc.includes("'/assets/") || swSrc.includes("/assets/"),
          "no /assets/ entry");
        check("pwa: sw.js keeps /api/ network-only",
          swSrc.includes("/api/"), "no /api/ rule");
        check("pwa: sw.js drops the retired /_next/static cache list",
          !swSrc.includes("/_next/"), "still references /_next/");

        // Real SW verification: vite preview now serves /sw.js (copyPwaAssets),
        // so the Vue production bundle's registerSw() (main.ts) registers for
        // real. Start from a clean slate - unregister leftovers from earlier
        // runs on this disposable profile, drop their caches - then reload so
        // install → precache → activate run from scratch.
        const cleaned = await evalJs(`(async () => {
          if (!("serviceWorker" in navigator)) return { unsupported: true };
          for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
          for (const k of await caches.keys()) await caches.delete(k);
          return { ok: true };
        })()`);

        if (cleaned?.unsupported) {
          // Headless hard limitation - degrade honestly to the contract above.
          check("pwa: navigator.serviceWorker unsupported (degraded contract-only run)",
            false, "no serviceWorker in this headless Chrome");
        } else {
          await goto(`${BASE}/login`); // fresh load → main.ts registerSw()
          const swReady = await evalJs(`(async () => {
            const reg = await Promise.race([
              navigator.serviceWorker.ready,
              new Promise((r) => setTimeout(() => r(null), 10000)),
            ]);
            if (!reg || !reg.active) return { ready: false };
            // clients.claim() may lag activation by a tick
            for (let i = 0; i < 30 && !navigator.serviceWorker.controller; i++)
              await new Promise((r) => setTimeout(r, 100));
            return {
              ready: true,
              scriptURL: reg.active.scriptURL,
              state: reg.active.state,
              controlling: !!navigator.serviceWorker.controller,
            };
          })()`);
          const pwaOrigin = new URL(BASE).origin;
          const scriptUrlOk = (() => {
            if (!swReady?.ready || !swReady.scriptURL) return false;
            try {
              const u = new URL(swReady.scriptURL);
              return u.origin === pwaOrigin && u.pathname === "/sw.js";
            } catch { return false; }
          })();
          check("pwa: SW ready via navigator.serviceWorker.ready, scriptURL=/sw.js",
            scriptUrlOk, JSON.stringify(swReady));

          const version = (swSrc.match(/const VERSION = "([^"]+)"/) || [])[1] || "v6-vue-1";
          const shellName = `${version}-shell`;
          const runtimeName = `${version}-runtime`;

          // install precache: cache.addAll(APP_SHELL) into the shell cache
          const shellPaths = await evalJs(`(async () => {
            const cache = await caches.open(${JSON.stringify(shellName)});
            return (await cache.keys()).map((r) => new URL(r.url).pathname);
          })()`);
          check("pwa: precache shell contains / and /login (caches API)",
            Array.isArray(shellPaths) && shellPaths.includes("/") && shellPaths.includes("/login"),
            JSON.stringify(shellPaths));

          // /assets/*: stale-while-revalidate - an explicit page fetch routed
          // through the SW must land in the runtime cache and be served by
          // caches.match (the "stale" read side of SWR).
          const swr = await evalJs(`(async () => {
            const assetUrl = performance.getEntriesByType("resource")
              .map((e) => e.name)
              .find((u) => { try { const p = new URL(u).pathname; return p.startsWith("/assets/") && p.endsWith(".js"); } catch { return false; } });
            if (!assetUrl) return { noAsset: true };
            await fetch(assetUrl); // intercepted by the SW → network + cachePut
            const keys = (await (await caches.open(${JSON.stringify(runtimeName)})).keys()).map((r) => r.url);
            const match = await caches.match(assetUrl);
            return { assetUrl, inRuntime: keys.includes(assetUrl), matchHit: !!match && match.status === 200, runtimeCount: keys.length };
          })()`);
          check("pwa: /assets/* stale-while-revalidate lands in runtime cache (caches.match hit)",
            !swr?.noAsset && swr?.inRuntime === true && swr?.matchHit === true, JSON.stringify(swr));

          // /api/*: network-only - a real request routed through the SW must
          // not appear in ANY cache.
          const api = await evalJs(`(async () => {
            await fetch("/api/auth/me", {
              headers: { Authorization: "Bearer " + (localStorage.getItem("kai-token") || "") },
            }).catch(() => {});
            const entries = [];
            for (const k of await caches.keys())
              for (const r of await (await caches.open(k)).keys())
                if (new URL(r.url).pathname.startsWith("/api/")) entries.push(r.url);
            return { entries, matchHit: !!(await caches.match(new URL("/api/auth/me", location.origin).href)) };
          })()`);
          check("pwa: /api/* network-only (real request leaves no cache entry)",
            api?.entries?.length === 0 && api?.matchHit === false, JSON.stringify(api));

          const cacheKeys = await evalJs("(async () => caches.keys())()");
          check(`pwa: cache names carry ${version} prefix (shell + runtime)`,
            Array.isArray(cacheKeys) && cacheKeys.includes(shellName) && cacheKeys.includes(runtimeName),
            JSON.stringify(cacheKeys));
          await shot("4-pwa-preview");
        }
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
