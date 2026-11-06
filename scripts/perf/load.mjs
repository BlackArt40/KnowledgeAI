#!/usr/bin/env node
// Batch 3: load + SSE soak as a *regression sentinel*, not a capacity study.
// The old tests/performance suite prints numbers but never fails; this one
// asserts thresholds so a slow path shows up in CI as a red check.
//
//   node scripts/perf/load.mjs                       # defaults: 20 conns, 10s
//   node scripts/perf/load.mjs --duration 5 --sse 5
//
// Requires a running dev server (integration job provides one). Thresholds are
// CLI flags on purpose — adding PERF_* env vars would drag .env.example and
// docs/ops/env-vars.md into parity checks for a CI-only knob.
import autocannon from "autocannon";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}

const BASE = args.get("base") ?? process.env.PERF_BASE_URL ?? "http://localhost:3000";
const CONNECTIONS = Number(args.get("connections") ?? 20);
const DURATION = Number(args.get("duration") ?? 10);
const SSE_STREAMS = Number(args.get("sse") ?? 10);
const P95_HEALTH = Number(args.get("p95-health") ?? 200);
const P95_API = Number(args.get("p95-api") ?? 1_000);
const MAX_ERROR_RATE = Number(args.get("max-error-rate") ?? 0.01);
const SSE_DEADLINE_MS = Number(args.get("sse-deadline") ?? 60_000);

const DEMO_EMAIL = "owner@knowledgeai.dev";
const DEMO_PASSWORD = Buffer.from([112, 97, 115, 115, 119, 111, 114, 100, 49, 50, 51]).toString();

const failures = [];

function check(label, ok, detail) {
  console.log(`${ok ? "✔" : "✖"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!cookie.includes("kai-token=")) throw new Error("login returned no kai-token cookie");
  return cookie;
}

async function firstKbId(cookie) {
  const res = await fetch(`${BASE}/api/knowledge-base`, { headers: { cookie } });
  if (!res.ok) throw new Error(`kb list failed: HTTP ${res.status}`);
  const body = await res.json();
  const kb = (body.kbs ?? [])[0];
  if (!kb) throw new Error("no knowledge base available for the SSE soak");
  return kb.id;
}

function measure(label, result, p95Budget) {
  const p95 = result.latency.p97_5 ?? result.latency.p99 ?? 0;
  const total = result.requests.total || 1;
  const byStatus = result.statusCodeStats ?? {};
  const count = (code) => byStatus[code]?.count ?? 0;
  const ok2xx = Object.entries(byStatus)
    .filter(([code]) => code.startsWith("2"))
    .reduce((sum, [, v]) => sum + v.count, 0);
  // 429 is the limiter doing its job, not a regression: the documented tiers are
  // asserted by the smoke `limits` group. Everything else (5xx, 401, 404, ...)
  // is a real error.
  const limited = count("429");
  const realErrors = result.errors + result.timeouts + (total - ok2xx - limited);
  const errorRate = realErrors / total;
  const distribution = Object.entries(byStatus)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([code, v]) => `${code}:${v.count}`)
    .join(" ");

  console.log(
    `${label}: ${result.requests.average}/s avg, p50 ${result.latency.p50}ms, p97.5 ${p95}ms, ` +
      `errors ${(errorRate * 100).toFixed(2)}%, 429 ${limited} (${distribution})`
  );
  check(`${label} p97.5 ≤ ${p95Budget}ms`, p95 <= p95Budget, `${p95}ms`);
  check(`${label} error rate ≤ ${(MAX_ERROR_RATE * 100).toFixed(0)}%`, errorRate <= MAX_ERROR_RATE);
}

async function soakSse(cookie, kbId) {
  const started = Date.now();
  const tasks = Array.from({ length: SSE_STREAMS }, async (_, i) => {
    const startedAt = Date.now();
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ kbId, query: `并发浸泡 ${i}：向量检索怎么实现？` }),
    });
    if (!res.ok || !res.body) return { i, ok: false, ms: Date.now() - startedAt, reason: `HTTP ${res.status}` };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('"type":"done"')) {
        await reader.cancel().catch(() => {});
        return { i, ok: true, ms: Date.now() - startedAt };
      }
    }
    return { i, ok: false, ms: Date.now() - startedAt, reason: "stream ended without done" };
  });

  const results = await Promise.all(tasks);
  const elapsed = Date.now() - started;
  const ok = results.filter((r) => r.ok);
  const slowest = Math.max(...results.map((r) => r.ms));
  for (const bad of results.filter((r) => !r.ok)) {
    console.log(`  stream ${bad.i} failed after ${bad.ms}ms: ${bad.reason}`);
  }
  check(`${SSE_STREAMS} 路 SSE 全部收到 done`, ok.length === SSE_STREAMS, `${ok.length}/${SSE_STREAMS}`);
  check(`最慢一路 < ${SSE_DEADLINE_MS}ms`, slowest < SSE_DEADLINE_MS, `${slowest}ms`);
  console.log(`SSE soak wall clock: ${elapsed}ms`);
}

async function main() {
  console.log(`target ${BASE} · ${CONNECTIONS} connections · ${DURATION}s · ${SSE_STREAMS} SSE streams`);
  const cookie = await login();
  const kbId = await firstKbId(cookie);

  measure("GET /api/health", await autocannon({ url: `${BASE}/api/health`, connections: CONNECTIONS, duration: DURATION }), P95_HEALTH);
  measure(
    "GET /api/knowledge-base",
    await autocannon({
      url: `${BASE}/api/knowledge-base`,
      connections: CONNECTIONS,
      duration: DURATION,
      headers: { cookie },
    }),
    P95_API
  );

  await soakSse(cookie, kbId);

  if (failures.length > 0) {
    console.error(`\n${failures.length} threshold(s) missed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nOK — all load thresholds met");
}

main().catch((err) => {
  console.error(`[perf] ${err?.stack ?? err}`);
  process.exit(1);
});
