// P7-3 acceptance verification: knowledge-graph visualization UI in a real
// headless Chrome via CDP.
//   - opens /knowledge-base/[id]/graph for a KB with entities
//   - asserts nodes + edges render in the SVG
//   - clicks a node -> neighbor edges highlight (primary color) + non-neighbor
//     nodes/edges dim to 0.25 opacity
// V6: 页面由 vite preview（:4173）承载 Vue 3 + Element Plus 版 KbGraphView，
// 断言已从 Next（React）DOM 改写为 Vue DOM：
//   - 图例/统计行按 Vue 版结构断言（.legend-item / .hint）
//   - 选中高亮按 Vue 版实现断言（primary 边 + 0.25 变暗），非 Next 的
//     stroke-width 2.5 / 详情面板 / 邻居 chips（Vue 侧未实现后两者）
// Run: npx node scripts/smoke/test-graph-ui.mjs  (requires `pnpm dev` + vite preview :4173)

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolveChrome, chromeMissingMessage, LOCALE_ARGS } from "./lib/chrome.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173"; // V6: 页面由 vite preview 承载（Next 纯 API）
const PORT = 9400 + Math.floor(Math.random() * 200); // 随机端口，避免残留实例冲突
const CHROME = resolveChrome();
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

  if (!existsSync(CHROME)) throw new Error(chromeMissingMessage());
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
    ...LOCALE_ARGS,
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
  ], { stdio: "ignore" });

  // P7-5: guarantee Chrome dies on EVERY exit path - process.exit()
  // skips finally blocks, so this handler is the last line of defense.
  process.on("exit", () => { try { chrome.kill("SIGKILL"); } catch {} });
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
    await sleep(4000);
    const nodeCount = await evalJs("document.querySelectorAll('svg[viewBox=\"0 0 900 560\"] circle').length");
    check("graph page: nodes rendered", nodeCount >= 3, `circles=${nodeCount}`);
    const edgeCount = await evalJs("document.querySelectorAll('svg[viewBox=\"0 0 900 560\"] line').length");
    check("graph page: edges rendered", edgeCount >= 1, `lines=${edgeCount}`);
    // V6: Vue 版图例渲染原始类型名（person/org/concept/event），非 Next 的
    // 「组织/人物」译文——断言 .legend-item 数量 + 类型名出现。
    const legend = await evalJs(`(() => {
      const items = document.querySelectorAll('.legend-item');
      const text = document.body.textContent;
      return { count: items.length, typed: text.includes('person') || text.includes('org') || text.includes('concept') || text.includes('event') };
    })()`);
    check("graph page: legend present", legend.count >= 2 && legend.typed === true, JSON.stringify(legend));
    // V6: Vue 版统计行是「N <s3> · M edges」的 .hint 段落，非 Next 的
    // 「已自动抽取 …」——断言 .hint 存在且含 edges 计数。
    const stats = await evalJs(`(() => {
      const hint = document.querySelector('.hint');
      return hint ? /\\d+/.test(hint.textContent) && hint.textContent.includes('edges') : false;
    })()`);
    check("graph page: stats line rendered", stats === true);
    // V7: 边坐标锚定断言——@shared/kg/layout 输出边端点是 label，组件已统一
    // 换算到 id 空间；修复前 find 恒失败导致所有线塌在 (0,0)。节点坐标被
    // layout clamp 在 [30, W-30]/[30, H-30]，合法边不可能全零。
    const anchored = await evalJs(`(() => {
      const lines = document.querySelectorAll('svg[viewBox="0 0 900 560"] line');
      let zero = 0;
      for (const l of lines) {
        if (!+l.getAttribute('x1') && !+l.getAttribute('y1') && !+l.getAttribute('x2') && !+l.getAttribute('y2')) zero++;
      }
      return { total: lines.length, zero };
    })()`);
    check("graph page: edges anchored to node positions", anchored.total >= 1 && anchored.zero === 0, JSON.stringify(anchored));
    await shot("01-graph");

    // ── 2. 交互: 点击节点 → 选中描边 + 邻接边 primary 高亮 + 其余变暗 ──
    console.log("\n── 2. 交互 ──");
    // V6: Vue 版节点 g 的类名是 .node（cursor:pointer 在 scoped CSS 里），
    // 不是 Next 的 g[cursor]/g.cursor-pointer。
    // V7: 点击目标改为必然有邻接边的节点——取 API 图数据里首条端点齐全的边
    // 的 source label，按 layout 的 mentions 降序换算成 DOM 序索引，保证
    // 「邻接边 primary 高亮」断言确定性（此前点 g.node[0]，可能无邻接边）。
    const labels = new Set(kbWithGraph.nodes.map((n) => n.label));
    const hubEdge = kbWithGraph.edges.find((e) => labels.has(e.source) && labels.has(e.target));
    const sortedNodes = [...kbWithGraph.nodes].sort((a, b) => b.mentions - a.mentions);
    const hubIdx = Math.max(0, sortedNodes.findIndex((n) => n.label === hubEdge?.source));
    check("setup: hub node resolved for click", hubEdge != null && hubIdx >= 0, `hub=${hubEdge?.source} idx=${hubIdx}`);
    await evalJs(`(() => {
      const g = document.querySelectorAll('svg g.node')[${hubIdx}];
      if (g) g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`);
    await sleep(600);
    // V7 断言（边高亮已修复）：KbGraphView 现把 layout 输出的 label 端点统一
    // 换算到节点 id 空间，选中语义完整——选中节点白描边 + 邻接边 primary 色
    // （opacity 0.7）+ 非邻接节点/边变暗（opacity 0.25）。详情面板
    // （「被提及…」）与邻居 chips 在 Vue 侧未迁移，相关断言仍移除。
    const clickState = await evalJs(`(() => {
      const svg = document.querySelector('svg[viewBox="0 0 900 560"]');
      if (!svg) return null;
      return {
        selectedStroke: svg.querySelectorAll('circle[stroke="hsl(var(--foreground))"]').length,
        primaryEdges: svg.querySelectorAll('line[stroke="hsl(var(--primary))"]').length,
        dimmedCircles: svg.querySelectorAll('circle[opacity="0.25"]').length,
        dimmedLines: svg.querySelectorAll('line[opacity="0.25"]').length,
      };
    })()`);
    check("node click: node selected (stroke highlight)", !!clickState && clickState.selectedStroke >= 1, JSON.stringify(clickState));
    check("node click: adjacent edges highlighted (primary)", !!clickState && clickState.primaryEdges >= 1, JSON.stringify(clickState));
    check("node click: non-neighbor nodes/edges dimmed", !!clickState && clickState.dimmedCircles >= 1 && clickState.dimmedLines >= 1, JSON.stringify(clickState));
    await shot("02-selected");

    // ── 3. 汇总 ─────────────────────────────────────────────────────────
    console.log("\n" + results.join("\n"));
    console.log(`\n${failures === 0 ? "✅" : "❌"} graph-ui smoke: ${results.length - failures}/${results.length} passed`);
    exitCode = failures > 0 ? 1 : 0;
    } catch (e) {
      console.error(e);
      exitCode = 1;
    } finally {
      chrome.kill("SIGTERM");
    }
    process.exit(exitCode);
}

main();
