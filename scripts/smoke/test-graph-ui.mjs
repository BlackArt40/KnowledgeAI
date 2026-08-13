// P7-3 acceptance verification: knowledge-graph visualization UI in a real
// headless Chrome via CDP.
//   - opens /knowledge-base/[id]/graph for a KB with entities
//   - asserts nodes + edges render in the SVG
//   - clicks a node -> neighbor highlight + detail panel appear
// Run: npx node scripts/smoke/test-graph-ui.mjs  (requires `pnpm dev`)

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PORT = 9400 + Math.floor(Math.random() * 200); // 随机端口，避免残留实例冲突
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = "/tmp/kai-graph-shots";
const PROFILE = `/tmp/kai-chrome-profile-graph-${Date.now()}`;

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

  // ── 0. 准备: 自建 KB + 上传构造文档（测试自包含，不依赖其他套件产物） ──
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@knowledgeai.dev", password: "password123" }),
  }).then((r) => r.json());
  const token = login.token;
  const H = { Authorization: `Bearer ${token}` };

  const created = await fetch(`${BASE}/api/v1/knowledge-bases`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ name: `图谱UI验收-${Date.now().toString(36)}` }),
  }).then((r) => r.json());
  const kbId = created.kb?.id;
  check("setup: create kb", !!kbId);

  // 与 test-graph-rag 相同的构造语料：干扰项 + 关系句 + 邻居实体句
  const DOCS = [
    { name: "distractor.txt", content:
      "晨曦科技在储能领域完成了三轮融资，累计金额超过十亿元。晨曦科技专注云计算与大数据。晨曦科技总部位于上海，储能研发团队超过两百人。" },
    { name: "relation.txt", content:
      "晨曦科技与蓝海集团达成战略合作，联合开发下一代储能系统。双方将共建联合实验室。" },
    { name: "answer.txt", content:
      "蓝海集团的储能业务由子公司蓝海能源负责运营，产品出口二十多个国家。蓝海能源专注储能电池与管理系统。" },
  ];
  const form = new FormData();
  for (const d of DOCS) form.append("files", new Blob([d.content], { type: "text/plain" }), d.name);
  const up = await fetch(`${BASE}/api/knowledge-base/${kbId}/upload`, {
    method: "POST", headers: H, body: form,
  });
  check("setup: upload 3 docs", up.status === 201, `status=${up.status}`);

  let ready = false;
  for (let i = 0; i < 60; i++) {
    const detail = await fetch(`${BASE}/api/knowledge-base/${kbId}`, { headers: H }).then((r) => r.json());
    const docs = detail.docs ?? [];
    if (docs.length === 3 && docs.every((d) => d.status === "ready")) { ready = true; break; }
    await sleep(500);
  }
  check("setup: docs processed (graph extracted)", ready, "timeout waiting for ready");

  let graph = null;
  for (let i = 0; i < 30; i++) {
    graph = await fetch(`${BASE}/api/knowledge-base/${kbId}/graph`, { headers: H }).then((r) => r.json());
    if ((graph.nodes ?? []).length >= 3 && (graph.edges ?? []).length >= 1) break;
    await sleep(500);
  }
  const kbWithGraph = { id: kbId, name: created.kb?.name ?? "", nodes: graph?.nodes ?? [], edges: graph?.edges ?? [] };
  check("setup: graph has >= 3 entities + edges", (graph?.nodes ?? []).length >= 3 && (graph?.edges ?? []).length >= 1);

  // login via the UI so the app shell has the session cookie
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
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

    // login form
    await sleep(2200);
    await evalJs(`(() => {
      const email = document.querySelector('#email');
      const pw = document.querySelector('#password');
      if (!email || !pw) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(email, "owner@knowledgeai.dev");
      email.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(pw, "password123");
      pw.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(400);
    await evalJs(`(() => {
      const form = document.querySelector('form');
      if (!form) return false;
      form.requestSubmit();
      return true;
    })()`);
    await sleep(3000);

    // ── 1. 图谱页面渲染 ────────────────────────────────────────────────
    console.log("\n── 1. 图谱页面 ──");
    await send("Page.navigate", { url: `${BASE}/knowledge-base/${kbWithGraph.id}/graph` });
    await sleep(3500);
    const nodeCount = await evalJs("document.querySelectorAll('svg[viewBox=\"0 0 900 560\"] circle').length");
    check("graph page: nodes rendered", nodeCount >= 3, `circles=${nodeCount}`);
    const edgeCount = await evalJs("document.querySelectorAll('svg[viewBox=\"0 0 900 560\"] line').length");
    check("graph page: edges rendered", edgeCount >= 1, `lines=${edgeCount}`);
    const legend = await evalJs("document.body.textContent.includes('组织') || document.body.textContent.includes('Organization') || document.body.textContent.includes('人物')");
    check("graph page: legend present", legend === true);
    const title = await evalJs("document.body.textContent.includes('已自动抽取') || document.body.textContent.includes('Auto-extracted')");
    check("graph page: stats line rendered", title === true);
    await shot("01-graph");

    // ── 2. 交互: 点击节点 → 高亮 + 详情面板 ─────────────────────────────
    console.log("\n── 2. 交互 ──");
    const firstNodeLabel = await evalJs(`(() => {
      const g = document.querySelectorAll('svg g[cursor]')[0] || document.querySelectorAll('svg g.cursor-pointer')[0];
      return g?.textContent ?? null;
    })()`);
    await evalJs(`(() => {
      const g = document.querySelectorAll('svg g.cursor-pointer')[0];
      if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`);
    await sleep(600);
    const detailPanel = await evalJs(`(() => {
      const text = document.body.textContent;
      return text.includes("被提及") || text.includes("Mentioned");
    })()`);
    check("node click: detail panel appears", detailPanel === true);
    const highlightActive = await evalJs(`(() => {
      const lines = [...document.querySelectorAll('svg[viewBox="0 0 900 560"] line')];
      const wide = lines.filter((l) => l.getAttribute('stroke-width') === '2.5');
      return wide.length > 0;
    })()`);

    check("node click: neighbor edges highlighted", highlightActive === true);
    const neighborChips = await evalJs(`(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => b.className.includes('rounded-full'));
      return btns.length;
    })()`);
    check("node click: neighbor chips listed", neighborChips >= 1, `chips=${neighborChips}`);
    await shot("02-selected");

    // ── 3. 汇总 ─────────────────────────────────────────────────────────
    console.log("\n" + results.join("\n"));
    console.log(`\n${failures === 0 ? "✅" : "❌"} graph-ui smoke: ${results.length - failures}/${results.length} passed`);
    process.exit(failures > 0 ? 1 : 0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    chrome.kill("SIGTERM");
  }
}

main();
