// @ts-nocheck
// P6-4 acceptance verification (HTTP): health checks & readiness probes.
//   - GET /api/health -> 200 (liveness, independent of dependencies)
//   - GET /api/health/ready -> 200 in demo mode (deps skipped = valid state)
//   - GET /api/health/db -> 200 in demo mode (skipped)
//   - 503 path: a second server instance (production `next start`, because
//     Next dev locks the project dir) with DATABASE_URL/REDIS_URL pointing at
//     dead ports -> /api/health/ready 503 (degraded), /api/health/db 503,
//     while /api/health stays 200 (liveness decoupled from dependencies)
//   - alerting: the 503 probe triggers an in-app securityAlert to admins
//     (visible via /api/notifications after login)
//   - health endpoints are in proxy SKIP_PATHS (rapid probing -> no 429)
// Run: npx tsx scripts/smoke/test-health.ts   (requires `pnpm dev` on :3000;
//       first run builds the production bundle for the broken-env instance)

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const BROKEN_PORT = 3100;
const BROKEN = `http://localhost:${BROKEN_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: process.cwd(), stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    p.on("error", reject);
  });
}

async function waitFor(base, path, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(3000) });
      if (res.status === 200) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

async function main() {
  let failures = 0;
  const results = [];
  function check(name, cond, detail = "") {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  // ── 0. demo 模式 dev server（:3000，无 DATABASE_URL/REDIS_URL） ──────
  console.log("\n── 0. 前置 ──");
  check("dev server 可达", await waitFor(BASE, "/api/health", 15000));

  // ── 1. 存活探针 ──
  console.log("\n── 1. /api/health（存活） ──");
  const liveness = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check("200 + status ok", liveness.status === "ok");
  check("uptimeMs 数字", typeof liveness.uptimeMs === "number" && liveness.uptimeMs >= 0);
  check("ts 数字", typeof liveness.ts === "number");

  // ── 2. 就绪探针（demo 模式：依赖 skipped = 合法就绪态） ──
  console.log("\n── 2. /api/health/ready（demo 模式） ──");
  const readyRes = await fetch(`${BASE}/api/health/ready`);
  const ready = await readyRes.json();
  check("200（demo 模式就绪）", readyRes.status === 200, `status=${readyRes.status}`);
  check("status ok", ready.status === "ok");
  const names = ready.checks?.map((c) => c.name) ?? [];
  check("checks 含 db/redis/llm", names.includes("db") && names.includes("redis") && names.includes("llm"));
  check("demo 模式全 skipped", ready.checks.every((c) => c.status === "skipped"), JSON.stringify(ready.checks));

  // ── 3. 数据库探针（demo 模式） ──
  console.log("\n── 3. /api/health/db（demo 模式） ──");
  const dbRes = await fetch(`${BASE}/api/health/db`);
  const dbCheck = await dbRes.json();
  check("200（skipped）", dbRes.status === 200, `status=${dbRes.status}`);
  check("check.status ok", dbCheck.check?.status === "skipped", JSON.stringify(dbCheck.check));

  // ── 4. 限流豁免：高频探测无 429 ──
  console.log("\n── 4. SKIP_PATHS 限流豁免 ──");
  let no429 = true;
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${BASE}/api/health`);
    if (res.status !== 200) { no429 = false; break; }
  }
  check("连续 30 次 /api/health 无 429", no429);

  // ── 5. 503 路径：坏依赖实例（:3100，生产 next start——dev 有目录锁） ──
  console.log(`\n── 5. 依赖不可用 → 503（:${BROKEN_PORT} 坏依赖实例） ──`);
  if (!existsSync(".next/BUILD_ID")) {
    console.log("  无生产构建，先 pnpm build（坏依赖实例需要 next start）...");
    await runCmd("pnpm", ["build"]);
  }
  const brokenServer = spawn("pnpm", ["start"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(BROKEN_PORT),
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:59999/knowledgeai?connect_timeout=1",
      REDIS_URL: "redis://127.0.0.1:59999",
      OPENAI_API_KEY: "",
    },
    stdio: "ignore",
    detached: true,
  });
  let brokenUp = false;
  try {
    brokenUp = await waitFor(BROKEN, "/api/health", 90000);
    check(`坏依赖实例启动（:${BROKEN_PORT}）`, brokenUp);

    const brokenReady = await fetch(`${BROKEN}/api/health/ready`);
    const brokenReadyData = await brokenReady.json();
    check("就绪探针 503", brokenReady.status === 503, `status=${brokenReady.status}`);
    check("status degraded", brokenReadyData.status === "degraded");
    check("degraded 含 db", brokenReadyData.degraded?.includes("db"), JSON.stringify(brokenReadyData.degraded));
    check("degraded 含 redis", brokenReadyData.degraded?.includes("redis"), JSON.stringify(brokenReadyData.degraded));
    check("degradedSince 非空", typeof brokenReadyData.degradedSince === "number");

    const brokenDb = await fetch(`${BROKEN}/api/health/db`);
    const brokenDbData = await brokenDb.json();
    check("数据库探针 503", brokenDb.status === 503, `status=${brokenDb.status}`);
    check("数据库探针 degraded", brokenDbData.check?.status === "degraded", JSON.stringify(brokenDbData.check));

    const brokenLive = await fetch(`${BROKEN}/api/health`);
    const brokenLiveData = await brokenLive.json();
    check("存活探针仍 200（与依赖解耦）", brokenLive.status === 200 && brokenLiveData.status === "ok", `status=${brokenLive.status}`);

    // ── 6. 告警端到端：503 探测触发 admin 站内通知 ──
    console.log("\n── 6. 告警通知（就绪失败 → securityAlert 给 owner/admin） ──");
    const login = await fetch(`${BROKEN}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@knowledgeai.dev", password: "password123" }),
    }).then((r) => r.json());
    check("坏依赖实例可登录（内存存储）", !!login.token);
    if (login.token) {
      const notifs = await fetch(`${BROKEN}/api/notifications?limit=10`, {
        headers: { Cookie: `kai-token=${login.token}` },
      }).then((r) => r.json());
      const alert = (notifs.notifications ?? []).find(
        (n) => n.type === "securityAlert" && (n.title ?? "").includes("依赖不可用")
      );
      check("owner 收到「服务依赖不可用」通知", !!alert, JSON.stringify(notifs.notifications ?? []).slice(0, 200));
    }
  } finally {
    // 清理坏依赖实例
    try { process.kill(-brokenServer.pid); } catch {}
    await sleep(1000);
  }

  // ── 汇总 ──
  console.log(`\n${results.join("\n")}`);
  console.log(`\nHealth acceptance: ${results.length - failures}/${results.length} passed, ${failures} FAILED`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
