// @ts-nocheck
// P6-1 acceptance verification (HTTP): observability.
//   - GET /api/admin/monitoring exposes the SLI dashboard aggregate (owner
//     200, editor 403, anonymous 401)
//   - full-chain tracing: a request carrying X-Trace-Id produces a trace
//     whose span tree covers API -> RAG -> LLM (chat) / API (search)
//   - POST /api/obs/report records client errors, visible via the dashboard
//   - after traffic, QPS / error rate / latency percentiles / LLM-by-model
//     (demo mode records "demo" calls) are populated
// Run: npx tsx scripts/smoke/test-monitoring.ts   (requires `pnpm dev`)

const BASE = process.env.BASE_URL || "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let failures = 0;
  const results = [];
  function check(name, cond, detail = "") {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  async function req(method, path, opts = {}) {
    const headers = {};
    const cookies = [];
    if (opts.token) cookies.push(`kai-token=${opts.token}`);
    if (cookies.length) headers.Cookie = cookies.join("; ");
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.traceId) headers["X-Trace-Id"] = opts.traceId;
    const res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  }

  /** POST /api/chat and read the SSE stream until `done` (test-chat-enhance pattern). */
  async function chatSse(token, body, traceId) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `kai-token=${token}`, "X-Trace-Id": traceId },
      body: JSON.stringify(body),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const events = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = raw.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        try { events.push(JSON.parse(line.slice(5).trim())); } catch {}
      }
    }
    return events;
  }

  // ── 0. 准备 ───────────────────────────────────────────────────────────
  console.log("\n── 0. 准备 ──");
  const login = (email) =>
    req("POST", "/api/auth/login", { body: { email, password: "password123" } });
  const owner = await login("owner@knowledgeai.dev");
  const token = owner.data?.token;
  check("login: owner token", !!token);
  const editor = await login("editor@knowledgeai.dev");
  const editorToken = editor.data?.token;
  check("login: editor token", !!editorToken);

  // ── 1. 权限与结构 ─────────────────────────────────────────────────────
  console.log("\n── 1. /api/admin/monitoring 权限与结构 ──");
  const anon = await req("GET", "/api/admin/monitoring");
  check("monitoring 匿名: 401", anon.status === 401, `status=${anon.status}`);
  const denied = await req("GET", "/api/admin/monitoring", { token: editorToken });
  check("monitoring editor: 403", denied.status === 403, `status=${denied.status}`);

  const mon = await req("GET", "/api/admin/monitoring", { token });
  const d = mon.data;
  check("monitoring owner: 200", mon.status === 200, `status=${mon.status}`);
  check("structure: requests SLI", !!d?.requests && typeof d.requests.errorRate === "number" && Array.isArray(d.requests.perMinute), JSON.stringify(d?.requests).slice(0, 120));
  check("structure: latency percentiles", "p50" in (d?.requests?.latency ?? {}) && "p95" in (d?.requests?.latency ?? {}) && "p99" in (d?.requests?.latency ?? {}));
  check("structure: llm byModel array", Array.isArray(d?.llm?.byModel), String(Array.isArray(d?.llm?.byModel)));
  check("structure: rag/doc/agent dimensions", !!d?.rag && !!d?.doc && !!d?.agent);
  check("structure: traces + errors lists", Array.isArray(d?.traces) && Array.isArray(d?.errors));

  // ── 2. 全链路追踪:search(API span)──────────────────────────────────
  console.log("\n── 2. 全链路追踪 ──");
  const tid1 = "test-trace-search-001";
  const sres = await req("GET", "/api/search?q=产品", { token, traceId: tid1 });
  check("search 200 (traced)", sres.status === 200, `status=${sres.status}`);
  const t1 = await req("GET", `/api/admin/monitoring/traces?id=${tid1}`, { token });
  const trace1 = t1.data?.trace;
  check("trace: search trace exists", !!trace1, JSON.stringify(t1.data).slice(0, 120));
  check("trace: api span recorded", (trace1?.spans ?? []).some((s) => s.kind === "api" && s.name === "api /api/search"), JSON.stringify(trace1?.spans?.map((s) => s.name)));
  check("trace: root status ok + duration", trace1?.status === "ok" && trace1?.durationMs >= 0);

  // ── 3. 全链路追踪:chat(API -> RAG -> LLM)─────────────────────────────
  const kbs = await req("GET", "/api/knowledge-base", { token });
  const kbId = (kbs.data?.kbs ?? []).find((k) => k.stats?.ready > 0)?.id ?? kbs.data?.kbs?.[0]?.id;
  check("setup: KB id for chat", !!kbId, String(kbId));
  const tid2 = "test-trace-chat-002";
  const events = await chatSse(token, { kbId, query: "介绍一下产品文档" }, tid2);
  check("chat SSE: done event", events.some((e) => e.type === "done"), `events=${events.map((e) => e.type).join(",")}`);
  await sleep(500); // let the trace finalize (stream finally)
  const t2 = await req("GET", `/api/admin/monitoring/traces?id=${tid2}`, { token });
  const trace2 = t2.data?.trace;
  const kinds2 = (trace2?.spans ?? []).map((s) => s.kind);
  check("trace: chat trace exists", !!trace2, JSON.stringify(t2.data).slice(0, 120));
  check("trace: API span (api /api/chat)", (trace2?.spans ?? []).some((s) => s.kind === "api" && s.name === "api /api/chat"), JSON.stringify(kinds2));
  check("trace: RAG span (rag.retrieve)", (trace2?.spans ?? []).some((s) => s.kind === "rag"), JSON.stringify(kinds2));
  check("trace: LLM span (chat stream)", (trace2?.spans ?? []).some((s) => s.kind === "llm"), JSON.stringify(kinds2));
  check("trace: span parent chain (rag under api)", (() => {
    const api = trace2?.spans?.find((s) => s.kind === "api");
    const rag = trace2?.spans?.find((s) => s.kind === "rag");
    return !!api && !!rag && rag.parentId === api.spanId;
  })(), JSON.stringify(trace2?.spans?.map((s) => [s.kind, s.parentId])));

  // ── 4. 错误上报 ───────────────────────────────────────────────────────
  console.log("\n── 4. 错误上报 ──");
  const report = await req("POST", "/api/obs/report", { body: { message: "monitoring-test client error", source: "test", url: "http://localhost/test" } });
  check("obs/report: 200", report.status === 200, `status=${report.status}`);
  await sleep(300);
  const mon2 = await req("GET", "/api/admin/monitoring", { token });
  const errSeen = (mon2.data?.errors ?? []).some((e) => e.message === "monitoring-test client error");
  check("errors: report visible in dashboard", errSeen === true, JSON.stringify(mon2.data?.errors?.slice(0, 2)));
  check("errors: source=client", (mon2.data?.errors ?? []).some((e) => e.message === "monitoring-test client error" && e.source === "client"));

  // ── 5. SLI 指标已填充 ────────────────────────────────────────────────
  console.log("\n── 5. SLI 指标 ──");
  const m3 = mon2.data;
  check("SLI: requests.total > 0", m3.requests.total > 0, String(m3.requests.total));
  check("SLI: per-minute series present", m3.requests.perMinute.length > 0 && m3.requests.perMinute.some((p) => p.count > 0));
  check("SLI: error rate >= 0 (computed)", typeof m3.requests.errorRate === "number" && m3.requests.errorRate >= 0);
  check("SLI: latency p95 present after traffic", m3.requests.latency.count > 0 && m3.requests.latency.p95 !== null, JSON.stringify(m3.requests.latency));
  check("SLI: rag.calls > 0 (chat ran retrieval)", m3.rag.calls > 0, String(m3.rag.calls));
  check("SLI: llm.byModel includes demo (demo-mode chat)", (m3.llm.byModel ?? []).some((m) => m.model === "demo" && m.calls > 0), JSON.stringify(m3.llm.byModel));
  check("SLI: llm totalTokens > 0", m3.llm.totalTokens > 0, String(m3.llm.totalTokens));
  check("SLI: llm costUsd >= 0", typeof m3.llm.costUsd === "number" && m3.llm.costUsd >= 0);
  check("SLI: uptime > 0", m3.uptimeMs > 0, String(m3.uptimeMs));

  // trace 列表出现在 dashboard
  check("dashboard: recent traces list non-empty", m3.traces.length > 0, String(m3.traces.length));

  console.log(`\n${results.join("\n")}`);
  console.log(`\nMonitoring HTTP acceptance: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
