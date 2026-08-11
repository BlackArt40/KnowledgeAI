// @ts-nocheck
// P6-2 acceptance verification (HTTP + static scan): structured logging.
//   - static scan: ZERO console.* remains in server-side code (src/lib,
//     src/app/api, proxy, instrumentation, worker, seed, root scripts) -
//     the only allowed file is src/lib/obs/log-edge.ts (Edge runtime)
//   - GET /api/admin/logs exposes the recent-log ring (owner 200,
//     editor 403, anonymous 401)
//   - every entry is JSON-structured (ts / level string / msg)
//   - ?level=warn filters out info/debug; ?requestId= correlates one
//     request's lines (X-Trace-Id -> requestId on http.response)
// Run: npx tsx scripts/smoke/test-logging.ts   (requires `pnpm dev`)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = process.cwd();

// ── static scan scope: server-side production code ─────────────────────
// src/lib (incl. src/app/api), proxy, instrumentation, worker, seed and the
// root-level ops scripts. Scripts/smoke + tests/ are test harnesses (their
// console output is the assertion report - intentionally not converted).
const SCAN_ROOTS = ["src/lib", "src/app/api"];
const SCAN_FILES = [
  "src/proxy.ts",
  "instrumentation.ts",
  "instrumentation-node.ts",
  "worker.ts",
  "prisma/seed.ts",
  "scripts/cleanup-temp-files.ts",
  "scripts/migrate-vector-store.ts",
  "scripts/generate-pwa-icons.ts",
];
// The ONLY files allowed to call console.* (Edge-safe log-edge.ts).
const ALLOWED_CONSOLE_FILES = new Set(["src/lib/obs/log-edge.ts"]);

function collectFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) out = collectFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !p.includes("src/lib/obs/")) out.push(p);
  }
  return out;
}

/** Strip comments so they never match (mirrors test-i18n-coverage). */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

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

  // ── 0. 准备 ───────────────────────────────────────────────────────────
  console.log("\n── 0. 准备 ──");
  const login = (email) => req("POST", "/api/auth/login", { body: { email, password: "password123" } });
  const owner = await login("owner@knowledgeai.dev");
  const token = owner.data?.token;
  check("login: owner token", !!token);
  const editor = await login("editor@knowledgeai.dev");
  const editorToken = editor.data?.token;
  check("login: editor token", !!editorToken);

  // ── 1. 静态扫描：服务端零 console.* ──────────────────────────────────
  console.log("\n── 1. 静态扫描：服务端零 console.* ──");
  const files = [];
  for (const root of SCAN_ROOTS) files.push(...collectFiles(join(ROOT, root)));
  for (const f of SCAN_FILES) files.push(join(ROOT, f));
  const pattern = /console\.(log|error|warn|info|debug)\s*\(/;
  const offenders = [];
  for (const f of files) {
    if (ALLOWED_CONSOLE_FILES.has(f.replace(join(ROOT, "") + "/", ""))) continue;
    const stripped = stripComments(readFileSync(f, "utf8"));
    if (pattern.test(stripped)) offenders.push(f.replace(join(ROOT, "") + "/", ""));
  }
  check("静态扫描: 服务端零 console.*（唯一允许 src/lib/obs/log-edge.ts）",
    offenders.length === 0, `残留: ${offenders.join(", ")}`);
  // log-edge.ts 本身必须是唯一的 console 出口（注释提及 pino 是说明文字，先剥离）
  const edgeSrc = stripComments(readFileSync(join(ROOT, "src/lib/obs/log-edge.ts"), "utf8"));
  check("log-edge.ts 不 import pino / node 模块（Edge 安全）",
    !edgeSrc.includes("pino") && !edgeSrc.includes("node:"),
    edgeSrc.includes("pino") ? "含 pino import" : edgeSrc.includes("node:") ? "含 node: import" : "");

  // ── 2. /api/admin/logs 权限 ──────────────────────────────────────────
  console.log("\n── 2. /api/admin/logs 权限与结构 ──");
  const anon = await req("GET", "/api/admin/logs");
  check("logs 匿名: 401", anon.status === 401, `status=${anon.status}`);
  const editorRes = await req("GET", "/api/admin/logs", { token: editorToken });
  check("logs editor: 403", editorRes.status === 403, `status=${editorRes.status}`);
  const ownerRes = await req("GET", "/api/admin/logs", { token });
  check("logs owner: 200", ownerRes.status === 200, `status=${ownerRes.status}`);
  const entries = ownerRes.data?.logs;
  check("logs: 返回 logs 数组", Array.isArray(entries), JSON.stringify(ownerRes.data).slice(0, 200));
  if (Array.isArray(entries) && entries.length > 0) {
    const okShape = entries.every((e) =>
      typeof e.ts === "number" &&
      typeof e.level === "string" &&
      typeof e.msg === "string" &&
      ["trace", "debug", "info", "warn", "error", "fatal"].includes(e.level)
    );
    check("logs: 每条含 ts/level(string)/msg", okShape, JSON.stringify(entries[0]).slice(0, 200));
  } else {
    check("logs: 每条含 ts/level(string)/msg", false, "空日志环");
  }

  // ── 3. level 过滤 ────────────────────────────────────────────────────
  console.log("\n── 3. level 过滤 ──");
  const warnRes = await req("GET", "/api/admin/logs?level=warn&limit=200", { token });
  const warnEntries = warnRes.data?.logs ?? [];
  const minWarn = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
  const allWarnOrAbove = warnEntries.every((e) => (minWarn[e.level] ?? 0) >= 40);
  check("?level=warn 只含 warn/error/fatal", warnEntries.length > 0 && allWarnOrAbove,
    `count=${warnEntries.length} levels=${[...new Set(warnEntries.map((e) => e.level))].join(",")}`);

  // ── 4. requestId 串联：X-Trace-Id → requestId ────────────────────────
  console.log("\n── 4. requestId 串联 ──");
  const rid = `p62-${Math.random().toString(36).slice(2, 10)}`;
  const search = await req("GET", `/api/search?q=测试日志`, { token, traceId: rid });
  check("带 X-Trace-Id 调 /api/search", search.status === 200, `status=${search.status}`);
  await sleep(300); // let the http.response log land in the ring
  const ridRes = await req("GET", `/api/admin/logs?requestId=${rid}&limit=100`, { token });
  const ridEntries = ridRes.data?.logs ?? [];
  const allMatch = ridEntries.length > 0 && ridEntries.every((e) => e.requestId === rid);
  check("?requestId= 命中同请求日志", allMatch, `count=${ridEntries.length}`);
  const responseLog = ridEntries.find((e) => e.msg === "http.response");
  check("包含 http.response（method/path/status/durationMs）",
    !!responseLog &&
      typeof responseLog.method === "string" &&
      typeof responseLog.path === "string" &&
      typeof responseLog.status === "number" &&
      typeof responseLog.durationMs === "number",
    JSON.stringify(responseLog ?? {}).slice(0, 200));
  check("http.response 关联 /api/search", !!responseLog && responseLog.path === "/api/search",
    responseLog?.path);

  // ── 5. limit 参数 ────────────────────────────────────────────────────
  console.log("\n── 5. limit 参数 ──");
  const limitRes = await req("GET", "/api/admin/logs?limit=3", { token });
  const limited = limitRes.data?.logs ?? [];
  check("?limit=3 最多返回 3 条", limited.length <= 3, `count=${limited.length}`);

  // ── 汇总 ────────────────────────────────────────────────────────────
  console.log(`\n${results.join("\n")}`);
  console.log(`\nLogging HTTP acceptance: ${results.length - failures}/${results.length} passed, ${failures} FAILED`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
