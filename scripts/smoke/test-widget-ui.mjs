// P7-2 acceptance verification: embeddable widget UI in a real headless
// Chrome via CDP (no extra dependencies - Node 22+ native WebSocket).
//   - opens /widget/demo.html, fills API key + KB, boots the widget
//   - asserts the floating button renders, the panel opens, a question gets
//     a streamed bot answer
// Run: MODE=widget npx node scripts/smoke/test-widget-ui.mjs  (requires `pnpm dev`)

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PORT = 9334;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = "/tmp/kai-widget-shots";
const PROFILE = `/tmp/kai-chrome-profile-widget-${Date.now()}`;

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

  // ── 0. 准备: 登录拿 API Key + KB ────────────────────────────────────
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@knowledgeai.dev", password: "password123" }),
  }).then((r) => r.json());
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` };
  const key = await fetch(`${BASE}/api/api-keys`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ name: "widget-ui", scopes: ["chat:read"] }),
  }).then((r) => r.json());
  const apiKey = key.key?.secret;
  const kbs = await fetch(`${BASE}/api/v1/knowledge-bases`, { headers: H }).then((r) => r.json());
  const kbId = kbs.kbs?.[0]?.id;
  check("setup: api key + kb", !!apiKey && !!kbId);

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
      `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + "/widget/demo.html")}`,
      { method: "PUT" }
    ).then((r) => r.json());

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const raw = String(ev.data);
      const msg = JSON.parse(raw);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.method && msg.method === "Page.javascriptDialogOpening") {
        // demo page / widget may raise alert() - auto-dismiss so the renderer
        // never blocks Runtime.evaluate
        send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      }
    };
    ws.onclose = (e) => console.log("[cdp-close]", e.code, e.reason);
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++msgId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 8000);
        pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evalJs = async (expression) => {
      const res = await send("Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: true,
      });
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
    await sleep(2500);

    // ── 1. 组件自举 ───────────────────────────────────────────────────
    console.log("\n── 1. 组件自举 ──");
    const api = await evalJs("typeof window.KnowledgeAIWidget?.init === 'function'");
    check("widget script loaded + init API", api === true);

    // 填写表单并加载组件
    await evalJs(`(() => {
      document.getElementById("apiKey").value = ${JSON.stringify(apiKey)};
      document.getElementById("kbId").value = ${JSON.stringify(kbId)};
      return true;
    })()`);
    await evalJs("boot()");
    await sleep(800);

    const fabVisible = await evalJs(`(() => {
      const el = document.querySelector(".kaiw-fab");
      return !!el && getComputedStyle(el).display !== "none";
    })()`);
    check("floating button rendered", fabVisible === true);
    await shot("01-fab");

    // ── 2. 打开面板并问答 ─────────────────────────────────────────────
    console.log("\n── 2. 面板问答 ──");
    await evalJs("document.querySelector('.kaiw-fab').click()");
    await sleep(600);
    const panelOpen = await evalJs("document.querySelector('.kaiw-panel').classList.contains('kaiw-open')");
    check("panel opens", panelOpen === true);

    const inputVal = await evalJs(`(() => {
      const ta = document.querySelector('.kaiw-input textarea');
      ta.value = "介绍一下这个知识库";
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value;
    })()`);
    check("composer accepts text", inputVal === "介绍一下这个知识库");
    await evalJs("document.querySelector('.kaiw-send').click()");
    await shot("02-asking");

    // 等待流式回答（demo 生成约 1-3s，轮询 15s）
    let answered = false;
    let text = "";
    for (let i = 0; i < 30; i++) {
      text = await evalJs(
        "Array.from(document.querySelectorAll('.kaiw-msg.kaiw-bot')).map(el => el.textContent).join('')"
      );
      if (text.length > 10) { answered = true; break; }
      await sleep(500);
    }
    check("bot answer streamed into panel", answered === true, `text=${text.slice(0, 60)}`);
    const userBubble = await evalJs("document.querySelectorAll('.kaiw-msg.kaiw-user').length");
    check("user question bubble rendered", userBubble >= 1, `n=${userBubble}`);
    await shot("03-answer");

    // ── 3. 汇总 ────────────────────────────────────────────────────────
    console.log("\n" + results.join("\n"));
    console.log(`\n${failures === 0 ? "✅" : "❌"} widget-ui smoke: ${results.length - failures}/${results.length} passed`);
    process.exit(failures > 0 ? 1 : 0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    chrome.kill("SIGTERM");
  }
}

main();
