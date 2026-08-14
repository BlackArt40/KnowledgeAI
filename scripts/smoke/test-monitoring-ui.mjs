// P6-1 acceptance verification in a real headless Chrome via CDP:
// the /admin/monitoring dashboard renders the SLI sections (QPS chart,
// latency percentiles, LLM by-model table, RAG/doc/agent cards, recent
// traces with expandable span trees, recent errors), and non-admins are
// redirected away.
// Run: node scripts/smoke/test-monitoring-ui.mjs  (requires `pnpm dev`)

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PORT = 9783;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = "/tmp/kai-monitoring-shots";
const PROFILE = "/tmp/kai-chrome-monitoring";

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
        throw new Error(`evalJs: ${res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text}`);
      }
      return res.result?.result?.value;
    };
    const shot = async (name) => {
      try {
        const res = await send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(res.result.data, "base64"));
      } catch {}
    };
    const waitFor = async (expression, timeoutMs = 15000, interval = 400) => {
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

    // login as owner + generate some traffic so the dashboard has data
    const login = (email) =>
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
    await send("Page.navigate", { url: `${BASE}/login` });
    await sleep(2500);
    const token = await login("owner@knowledgeai.dev");
    check("login: owner token obtained", !!token);

    // traffic: a traced search + a traced chat so traces/LLM/RAG SLIs exist
    await send("Page.navigate", { url: `${BASE}/dashboard` });
    await sleep(2500);
    await evalJs(`fetch("${BASE}/api/search?q=产品", { headers: { "X-Trace-Id": "ui-trace-search-1" } })`);
    await sleep(400);
    const kbInfo = await evalJs(`fetch("${BASE}/api/knowledge-base").then(r => r.json()).then(d => {
      const kb = (d.kbs ?? []).find(k => k.stats?.ready > 0) ?? (d.kbs ?? [])[0];
      return kb ? kb.id : null;
    })`);
    if (kbInfo) {
      await evalJs(`(async () => {
        const res = await fetch("${BASE}/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Trace-Id": "ui-trace-chat-1" },
          body: JSON.stringify({ kbId: "${kbInfo}", query: "介绍一下" }),
        });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
        }
        return buf.includes('"type":"done"');
      })()`);
    }
    check("traffic: chat done (KB available)", !!kbInfo, String(kbInfo));

    // ── 1. owner sees the dashboard ─────────────────────────────────────
    console.log("\n── 1. owner 仪表盘渲染 ──");
    await send("Page.navigate", { url: `${BASE}/admin/monitoring` });
    await waitFor(`document.body.innerText.includes("可观测性")`);
    await sleep(800);
    const ownerState = await evalJs(`(() => {
      const text = document.body.innerText;
      return {
        title: text.includes("可观测性"),
        qpsCard: text.includes("QPS"),
        latency: text.includes("P50") && text.includes("P95") && text.includes("P99"),
        llmSection: text.includes("LLM 调用监控"),
        modelRow: text.includes("demo") || text.includes("gpt-4o"),
        ragCard: text.includes("RAG 检索"),
        docCard: text.includes("文档处理"),
        agentCard: text.includes("Agent 调研"),
        tracesSection: text.includes("最近追踪"),
        errorsSection: text.includes("最近错误"),
        refreshBtn: [...document.querySelectorAll("button")].some((b) => b.textContent.includes("刷新")),
        charts: document.querySelectorAll("svg").length,
      };
    })()`);
    check("dashboard: 标题渲染", ownerState.title === true);
    check("dashboard: QPS 卡片", ownerState.qpsCard === true);
    check("dashboard: 延迟 P50/P95/P99", ownerState.latency === true);
    check("dashboard: LLM 调用监控 + 模型行", ownerState.llmSection === true && ownerState.modelRow === true, JSON.stringify(ownerState));
    check("dashboard: RAG/文档/Agent 卡片", ownerState.ragCard && ownerState.docCard && ownerState.agentCard);
    check("dashboard: 最近追踪 + 最近错误区块", ownerState.tracesSection === true && ownerState.errorsSection === true);
    check("dashboard: 刷新按钮", ownerState.refreshBtn === true);
    check("dashboard: 至少一个 SVG 图表", ownerState.charts >= 1, `svgs=${ownerState.charts}`);
    await shot("1-owner-dashboard");

    // ── 2. expand a trace -> span tree ──────────────────────────────────
    console.log("\n── 2. span 树展开 ──");
    const expanded = await waitFor(`(() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("api /api/chat") || b.textContent.includes("api /api/search"));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await sleep(1200);
    const spanTree = await evalJs(`(() => {
      const text = document.body.innerText;
      return {
        traceIdShown: text.includes("追踪 id"),
        apiSpan: text.includes("api /api/chat") || text.includes("api /api/search"),
        kindChips: /api|rag|llm|doc|agent/.test(text),
      };
    })()`);
    check("span tree: 展开 + 追踪 id 显示", expanded === true && spanTree.traceIdShown === true, JSON.stringify(spanTree));
    check("span tree: span 名称与类型 chips", spanTree.apiSpan === true && spanTree.kindChips === true, JSON.stringify(spanTree));
    await shot("2-span-tree");

    // ── 3. editor is redirected away ────────────────────────────────────
    console.log("\n── 3. 非 admin 访问控制 ──");
    await login("editor@knowledgeai.dev");
    await send("Page.navigate", { url: `${BASE}/admin/monitoring` });
    await sleep(2500);
    const editorUrl = await evalJs(`window.location.pathname`);
    check("editor: /admin/monitoring 被重定向", editorUrl !== "/admin/monitoring", editorUrl);
    check("editor: 无监控内容", !(await evalJs(`document.body.innerText.includes("可观测性")`)));

    console.log(`\n${results.join("\n")}`);
    console.log(`\nMonitoring UI acceptance: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""} (screenshots: ${OUT_DIR})`);
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
