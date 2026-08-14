// P7-4 acceptance verification: multimodal chat UI in headless Chrome (CDP).
//   - chat page has the attach-image button, the voice-input mic button and
//     the read-aloud (TTS) button on assistant messages
//   - attaching an image shows a preview thumbnail with a remove control
// Run: npx node scripts/smoke/test-multimodal-ui.mjs  (requires `pnpm dev`)

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PORT = 9339;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = "/tmp/kai-multimodal-shots";
const PROFILE = `/tmp/kai-chrome-profile-mm-${Date.now()}`;

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
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--lang=zh-CN",
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
      } else if (msg.method === "Page.javascriptDialogOpening") {
        send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++msgId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 10000);
        pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
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
      } catch {}
    };

    await send("Page.enable");
    await send("Runtime.enable");

    // ── 0. 登录 ─────────────────────────────────────────────────────────
    await sleep(2200);
    await evalJs(`(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const email = document.querySelector('#email');
      const pw = document.querySelector('#password');
      if (!email || !pw) return false;
      setter.call(email, "owner@knowledgeai.dev");
      email.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(pw, "password123");
      pw.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(400);
    await evalJs("document.querySelector('form')?.requestSubmit()");
    await sleep(3000);

    // ── 1. 聊天页多模态入口 ────────────────────────────────────────────
    console.log("\n── 1. 聊天页多模态入口 ──");
    // 预取一个 KB id（deep link ?kb= 直接选中）
    const login2 = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@knowledgeai.dev", password: "password123" }),
    }).then((r) => r.json());
    const kbs = await fetch(`${BASE}/api/v1/knowledge-bases`, {
      headers: { Authorization: `Bearer ${login2.token}` },
    }).then((r) => r.json());
    const firstKb = kbs.kbs?.[0]?.id ?? "";
    check("setup: kb id for chat", !!firstKb);
    await send("Page.navigate", { url: `${BASE}/chat?kb=${firstKb}` });
    await sleep(3500);

    const attachBtn = await evalJs(`(() => {
      const btns = [...document.querySelectorAll('button')];
      return btns.some((b) => b.getAttribute('aria-label')?.includes('添加图片') || b.title?.includes('添加图片'));
    })()`);
    check("chat page: attach-image button present", attachBtn === true);

    const micBtn = await evalJs(`(() => {
      const btns = [...document.querySelectorAll('button')];
      return btns.some((b) => b.getAttribute('aria-label')?.includes('语音输入'));
    })()`);
    // 语音输入依赖 Web Speech API - headless Chrome 可能不支持（检测到则隐藏）
    const micExpected = await evalJs("'SpeechRecognition' in window || 'webkitSpeechRecognition' in window");
    if (micExpected) {
      check("chat page: mic (voice input) button present", micBtn === true);
    } else {
      console.log("  (headless Chrome 无 SpeechRecognition - 按钮按设计隐藏，跳过)");
      check("chat page: mic hidden when unsupported", micBtn === false);
    }
    await shot("01-chat-actions");

    // ── 2. 图片附件预览 ────────────────────────────────────────────────
    console.log("\n── 2. 图片附件预览 ──");
    const previewShown = await evalJs(`(() => {
      // 通过 DataTransfer 模拟选择文件（1x1 PNG）
      const input = document.querySelector('input[type="file"][accept="image/*"]');
      if (!input) return false;
      const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], "shot.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    check("file input found + change dispatched", previewShown === true);
    await sleep(800);
    const preview = await evalJs("document.querySelectorAll('img[src^=\"data:image\"]').length");
    check("attachment preview thumbnail rendered", preview >= 1, `imgs=${preview}`);
    const removeBtn = await evalJs(`(() => {
      const btns = [...document.querySelectorAll('button')];
      return btns.some((b) => b.getAttribute('aria-label')?.includes('移除图片'));
    })()`);
    check("preview remove control present", removeBtn === true);
    await shot("02-attachment");

    // ── 3. 朗读按钮（TTS）──────────────────────────────────────────────
    console.log("\n── 3. 朗读按钮 ──");
    // 发送一条问题，等回答出现后检查朗读按钮
    const typed = await evalJs(`(() => {
      const ta = document.querySelector('textarea');
      if (!ta) return 'no-textarea';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "介绍一下这个知识库");
      ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "介绍一下这个知识库" }));
      return ta.value;
    })()`);
    await sleep(400);
    const sendDisabled = await evalJs(`(() => {
      const sendBtn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.includes('发送'));
      return sendBtn ? sendBtn.disabled : 'no-btn';
    })()`);
    await evalJs(`(() => {
      const sendBtn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.includes('发送'));
      if (sendBtn && !sendBtn.disabled) sendBtn.click();
      return true;
    })()`);
    let readAloud = false;
    for (let i = 0; i < 40; i++) {

      readAloud = await evalJs(`(() => {
        const btns = [...document.querySelectorAll('button')];
        return btns.some((b) => (b.textContent || '').includes('朗读回答') || (b.textContent || '').includes('Read aloud'));
      })()`);
      if (readAloud) break;
      await sleep(500);
    }
    check("assistant message read-aloud button appears", readAloud === true);
    await shot("03-readaloud");

    console.log("\n" + results.join("\n"));
    console.log(`\n${failures === 0 ? "✅" : "❌"} multimodal-ui smoke: ${results.length - failures}/${results.length} passed`);
    exitCode = failures > 0 ? 1 : 0;
    } catch (err) {
      console.error(e);
      exitCode = 1;
    } finally {
      chrome.kill();
    }
    process.exit(exitCode);
}

main();
