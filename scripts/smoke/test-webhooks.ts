// @ts-nocheck
// P7-1 acceptance verification: webhook reliable push (with retry).
//
//   - creates a local receiver HTTP server and a webhook subscription
//   - POST /api/v1/webhooks/[id]/test delivers a signed `ping` (HMAC verified)
//   - kb.ready fires when a document finishes processing (upload -> ready)
//   - agent.completed fires when an agent task completes
//   - usage.alert fires when the workspace crosses the plan QA limit (the
//     test workspace plan is free => limit 100; we burn the remaining quota)
//   - retry: receiver returns 500 for the first N attempts, then succeeds -
//     the delivery must eventually arrive (queue retries, 3 attempts)
//   - dead-letter: a permanently failing receiver leaves the subscription
//     marked failed (lastError set, failures > 0)
//
// Run: npx tsx scripts/smoke/test-webhooks.ts   (requires `pnpm dev`)

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Local receiver: records deliveries, verifies the HMAC signature. */
function startReceiver(secret, { failFirst = 0, alwaysFail = false } = {}) {
  const deliveries = [];
  let attempts = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      attempts++;
      const sig = req.headers["x-kai-signature"];
      const event = req.headers["x-kai-event"];
      let verified = false;
      if (sig && typeof sig === "string" && sig.startsWith("sha256=")) {
        const expected = createHmac("sha256", secret).update(body).digest("hex");
        const a = Buffer.from(sig.slice(7));
        const b = Buffer.from(expected);
        verified = a.length === b.length && timingSafeEqual(a, b);
      }
      deliveries.push({ event, verified, body: JSON.parse(body), status: null });
      if (alwaysFail || attempts <= failFirst) {
        res.writeHead(500); res.end("boom");
        deliveries[deliveries.length - 1].status = 500;
      } else {
        res.writeHead(200); res.end("ok");
        deliveries[deliveries.length - 1].status = 200;
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}/hook`,
        deliveries,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function main() {
  let failures = 0;
  const results = [];
  function check(name, cond, detail = "") {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  const req = async (method, path, opts = {}) => {
    const headers = {};
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.wsCookie) headers.Cookie = `kai-workspace=${opts.wsCookie}`;
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };

  const login = await req("POST", "/api/auth/login", {
    body: { email: "owner@knowledgeai.dev", password: "password123" },
  });
  const token = login.data?.token;
  check("login: owner token", !!token);

  // ── 1. 订阅 CRUD + ping ─────────────────────────────────────────────
  console.log("\n── 1. 订阅 CRUD + 签名投递 ──");
  const SECRET = "p7-test-secret-123";
  const receiver = await startReceiver(SECRET);
  const subRes = await req("POST", "/api/v1/webhooks", {
    token,
    body: { name: "验收接收端", url: receiver.url, secret: SECRET, events: ["kb.ready", "agent.completed", "usage.alert"] },
  });
  const subId = subRes.data?.webhook?.id;
  check("create webhook: 201 + id", subRes.status === 201 && !!subId, JSON.stringify(subRes.data).slice(0, 150));

  const badUrl = await req("POST", "/api/v1/webhooks", {
    token,
    body: { name: "bad", url: "file:///etc/passwd", events: ["kb.ready"] },
  });
  check("reject non-http url: 400", badUrl.status === 400, `status=${badUrl.status}`);

  const badEvents = await req("POST", "/api/v1/webhooks", {
    token, body: { name: "bad", url: "https://example.com/x", events: ["nope"] },
  });
  check("reject unknown event: 400", badEvents.status === 400, `status=${badEvents.status}`);

  const listRes = await req("GET", "/api/v1/webhooks", { token });
  check("list webhooks: includes sub", Array.isArray(listRes.data?.webhooks) && listRes.data.webhooks.some((w) => w.id === subId));

  const ping = await req("POST", `/api/v1/webhooks/${subId}/test`, { token });
  check("test ping: 200", ping.status === 200, `status=${ping.status}`);
  await sleep(1500);
  check("receiver got ping", receiver.deliveries.some((d) => d.event === "ping"), `events=${receiver.deliveries.map((d) => d.event).join(",")}`);
  const pingDlv = receiver.deliveries.find((d) => d.event === "ping");
  check("ping: HMAC signature verified", !!pingDlv?.verified);
  check("ping: payload has ts + data", !!pingDlv?.body?.ts && !!pingDlv?.body?.data?.message);

  // ── 2. kb.ready 事件 ─────────────────────────────────────────────────
  console.log("\n── 2. kb.ready 事件 ──");
  const kbRes = await req("POST", "/api/v1/knowledge-bases", {
    token, body: { name: "Webhook 验收库" },
  });
  const kbId = kbRes.data?.kb?.id;
  check("create kb", !!kbId);
  const form = new FormData();
  form.append("files", new Blob(["这是webhook验收文档，包含关键词：星辰协议"], { type: "text/plain" }), "wh-doc.txt");
  const upRes = await fetch(`${BASE}/api/knowledge-base/${kbId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  check("upload doc: 201", upRes.status === 201, `status=${upRes.status}`);
  // wait for doc-processing (parse -> chunk -> vectorize) + webhook delivery
  let kbReady = null;
  for (let i = 0; i < 40; i++) {
    kbReady = receiver.deliveries.find((d) => d.event === "kb.ready");
    if (kbReady) break;
    await sleep(500);
  }
  check("kb.ready delivered", !!kbReady, "timeout waiting for kb.ready");
  if (kbReady) {
    check("kb.ready: signed", kbReady.verified);
    check("kb.ready: payload has kbId/docName", kbReady.body.data.kbId === kbId && !!kbReady.body.data.docName, JSON.stringify(kbReady.body.data));
  }

  // ── 3. agent.completed 事件 ──────────────────────────────────────────
  console.log("\n── 3. agent.completed 事件 ──");
  const agentRun = await fetch(`${BASE}/api/agent/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ topic: "一句话总结：什么是知识管理" }),
  });
  check("agent run: 200 SSE", agentRun.status === 200, `status=${agentRun.status}`);
  let agentDone = null;
  for (let i = 0; i < 60; i++) {
    agentDone = receiver.deliveries.find((d) => d.event === "agent.completed");
    if (agentDone) break;
    await sleep(500);
  }
  check("agent.completed delivered", !!agentDone, "timeout waiting for agent.completed");
  if (agentDone) {
    check("agent.completed: signed", agentDone.verified);
    check("agent.completed: payload has taskId/topic/status", !!agentDone.body.data.taskId && agentDone.body.data.status === "done", JSON.stringify(agentDone.body.data).slice(0, 150));
  }

  // ── 4. usage.alert 事件（免费版额度 100 次问答） ─────────────────────
  console.log("\n── 4. usage.alert 事件 ──");
  // 用量告警按 (工作区, 额度) 去重且工作区用量在服务进程内累积 —— 用一个
  // 全新工作区保证本用例每次运行都能真实跨越 100 次问答阈值。Webhook 订阅
  // 也是工作区隔离的,所以在该工作区内新建订阅。
  const wsRes = await req("POST", "/api/workspaces", { token, body: { name: "告警验收空间" } });
  const wsId = wsRes.data?.workspace?.id;
  check("create fresh workspace for usage.alert", !!wsId, JSON.stringify(wsRes.data).slice(0, 120));

  const wsSubRes = await req("POST", "/api/v1/webhooks", {
    token,
    body: { name: "告警接收端", url: receiver.url, secret: SECRET, events: ["usage.alert"] },
    wsCookie: wsId,
  });
  check("create webhook in fresh workspace", wsSubRes.status === 201, `status=${wsSubRes.status}`);

  // 并发补足 100 次问答（并行请求，避免串行等待生成）。
  const kbInWs = await req("POST", "/api/v1/knowledge-bases", {
    token, wsCookie: wsId, body: { name: "告警库" },
  });
  const wsKbId = kbInWs.data?.kb?.id;
  check("create kb in fresh workspace", !!wsKbId);
  await Promise.allSettled(
    Array.from({ length: 100 }, () =>
      fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Cookie: `kai-workspace=${wsId}`,
        },
        body: JSON.stringify({ kbId: wsKbId, query: "测试用量告警" }),
      }).catch(() => {})
    )
  );
  let usageAlert = null;
  for (let i = 0; i < 60; i++) {
    usageAlert = receiver.deliveries.find((d) => d.event === "usage.alert");
    if (usageAlert) break;
    await sleep(500);
  }
  check("usage.alert delivered at 100 QA", !!usageAlert, "timeout waiting for usage.alert");
  if (usageAlert) {
    check("usage.alert: signed", usageAlert.verified);
    check("usage.alert: payload has plan/usage/limit", usageAlert.body.data.plan === "free" && usageAlert.body.data.limit === 100, JSON.stringify(usageAlert.body.data).slice(0, 150));
  }

  // ── 5. 重试与死信 ────────────────────────────────────────────────────
  console.log("\n── 5. 重试 + 死信 ──");
  const flaky = await startReceiver(SECRET, { failFirst: 1 });
  const flakySub = await req("POST", "/api/v1/webhooks", {
    token,
    body: { name: "抖动接收端", url: flaky.url, secret: SECRET, events: ["kb.ready"] },
  });
  const flakyId = flakySub.data?.webhook?.id;
  await req("POST", `/api/v1/webhooks/${flakyId}/test`, { token });
  let retried = null;
  for (let i = 0; i < 40; i++) {
    retried = flaky.deliveries.find((d) => d.status === 200);
    if (retried) break;
    await sleep(500);
  }
  check("retry: delivery succeeds after first failure", !!retried, "no successful retry");
  check("retry: attempt count >= 2", flaky.deliveries.length >= 2, `attempts=${flaky.deliveries.length}`);

  const dead = await startReceiver(SECRET, { alwaysFail: true });
  const deadSub = await req("POST", "/api/v1/webhooks", {
    token,
    body: { name: "永久失败", url: dead.url, secret: SECRET, events: ["kb.ready"] },
  });
  const deadId = deadSub.data?.webhook?.id;
  await req("POST", `/api/v1/webhooks/${deadId}/test`, { token });
  let deadState = null;
  for (let i = 0; i < 40; i++) {
    const r = await req("GET", `/api/v1/webhooks/${deadId}`, { token });
    if (r.data?.webhook?.failures > 0) { deadState = r.data.webhook; break; }
    await sleep(500);
  }
  check("dead-letter: failures > 0 recorded", !!deadState, "no failure state");
  check("dead-letter: lastError set", !!deadState?.lastError, String(deadState?.lastError));

  // delete + workspace isolation
  const del = await req("DELETE", `/api/v1/webhooks/${subId}`, { token });
  check("delete webhook: 200", del.status === 200 && del.data?.ok === true, `status=${del.status}`);
  const afterDel = await req("GET", `/api/v1/webhooks/${subId}`, { token });
  check("deleted webhook: 404", afterDel.status === 404, `status=${afterDel.status}`);

  await receiver.close();
  await flaky.close();
  await dead.close();

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "✅" : "❌"} webhooks smoke: ${results.length - failures}/${results.length} passed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
