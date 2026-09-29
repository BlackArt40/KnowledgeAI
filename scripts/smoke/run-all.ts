// Acceptance smoke suite runner.
//
//   npx tsx scripts/smoke/run-all.ts --group lib
//   npx tsx scripts/smoke/run-all.ts --group http --parallel 2
//   npx tsx scripts/smoke/run-all.ts --only webhooks --json /tmp/smoke.json
//
// Each script is spawned as its own process (tsx for .ts/.tsx, node for .mjs)
// with BASE_URL exported, so scripts keep working standalone. A script's exit
// code is the verdict; a missing prerequisite is a SKIP (never a failure) and
// a missing dev server fails the http/ui groups fast instead of hanging.
//
// The report (JSON + Markdown) lands in scripts/smoke/.report/ so CI can
// upload it as an artifact.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SMOKE_GROUPS, SMOKE_MANIFEST, type SmokeEntry, type SmokeGroup, type SmokePrereq } from "./lib/manifest";
import { resolveSmokeBase } from "./lib/base-url";
import { DEMO_PASSWORD } from "./lib/demo";
import { ocrAvailable } from "./lib/ocr-available";

const ROOT = resolve(__dirname, "../..");
const REPORT_DIR = join(ROOT, "scripts/smoke/.report");
const DEFAULT_TIMEOUT_MS = 180_000;

type Verdict = "pass" | "fail" | "skip" | "timeout";

interface Result {
  id: string;
  group: SmokeGroup;
  verdict: Verdict;
  ms: number;
  exitCode: number | null;
  summary: string;
  note?: string;
  outputTail: string[];
}

// ── CLI ──────────────────────────────────────────────────────────────────

interface Options {
  groups: SmokeGroup[];
  only: string[];
  skip: string[];
  parallel: number;
  json: string | null;
  list: boolean;
  elevate: number | null;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { groups: [], only: [], skip: [], parallel: 1, json: null, list: false, elevate: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    switch (arg) {
      case "--group":
      case "-g": {
        const raw = next();
        const groups = raw === "all" ? [...SMOKE_GROUPS] : (raw.split(",").filter(Boolean) as SmokeGroup[]);
        for (const g of groups) {
          if (!SMOKE_GROUPS.includes(g)) throw new Error(`unknown group "${g}" (expected ${SMOKE_GROUPS.join("|")}|all)`);
        }
        opts.groups.push(...groups);
        break;
      }
      case "--only": opts.only.push(next()); break;
      case "--skip": opts.skip.push(next()); break;
      case "--parallel": opts.parallel = Math.max(1, Number(next()) || 1); break;
      case "--json": opts.json = next(); break;
      case "--list": opts.list = true; break;
      case "--timeout": process.env.SMOKE_TIMEOUT_MS = next(); break;
      case "--elevate": opts.elevate = Math.max(1, Number(next()) || 0) || null; break;
      case "--help":
      case "-h":
        console.log(helpText());
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown flag ${arg} (try --help)`);
        opts.only.push(arg);
    }
  }
  if (opts.groups.length === 0) opts.groups = [...SMOKE_GROUPS];
  return opts;
}

function helpText(): string {
  return [
    "Acceptance smoke runner",
    "",
    "  --group, -g <lib|http|limits|ui|infra|all>  groups to run (default: all; comma-joined allowed)",
    "  --only <substring>                   run matching ids only (repeatable / positional)",
    "  --skip <substring>                   drop matching ids (repeatable)",
    "  --parallel <n>                       concurrent scripts (default 1)",
    "  --json <path>                        extra JSON report path",
    "  --timeout <ms>                       default per-script timeout (default 180000)",
    "  --elevate <n>                        raise the admin-store user tier to <n> for",
    "                                       this run, then restore it (see --help notes)",
    "  --list                               print the manifest and exit",
    "",
    `Environment: BASE_URL (default ${resolveSmokeBase()}), CHROME_PATH for the ui group.`,
    "",
    "Notes:",
    "  * /api/chat's in-route user tier resolves its limit from the admin store",
    "    (demo default 60 - src/lib/admin/store.ts), NOT from RATE_LIMIT_PER_MIN.",
    "    A long multi-script run therefore 429s itself unless --elevate is used.",
    "  * --elevate must not be combined with the `limits` group: that group",
    "    asserts the DOCUMENTED default tiers and needs its own server.",
  ].join("\n");
}

// ── prerequisites ────────────────────────────────────────────────────────

function commandExists(cmd: string): boolean {
  const paths = (process.env.PATH ?? "").split(":");
  return paths.some((p) => p && existsSync(join(p, cmd)));
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
].filter((p): p is string => Boolean(p));

async function reachable(url: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500 || res.status === 503;
  } catch {
    return false;
  }
}

let prereqCache: Map<SmokePrereq, string | null> | null = null;

/** Returns the skip reason for a missing prerequisite, or null when satisfied. */
async function missingPrereq(prereq: SmokePrereq): Promise<string | null> {
  if (!prereqCache) prereqCache = new Map();
  const cached = prereqCache.get(prereq);
  if (cached !== undefined) return cached;

  let reason: string | null = null;
  switch (prereq) {
    case "chrome":
      if (!CHROME_CANDIDATES.some((p) => existsSync(p))) reason = "no Chrome/Chromium binary (set CHROME_PATH)";
      break;
    case "ocr":
      if (!ocrAvailable()) reason = "tesseract language packs missing in .tessdata/ (or OCR_ENABLED=false)";
      break;
    case "go":
      if (!commandExists("go")) reason = "go not installed";
      break;
    case "python":
      if (!commandExists("python3") && !commandExists("python")) reason = "python3 not installed";
      break;
    case "db":
      if (!process.env.DATABASE_URL) reason = "DATABASE_URL not set";
      break;
    case "chromadb":
      if (!(await reachable(`${process.env.CHROMADB_URL ?? "http://localhost:8000"}/api/v1/heartbeat`))) {
        reason = "chromadb not reachable on :8000";
      }
      break;
    case "pinecone-mock":
      if (!(await reachable("http://localhost:5080"))) reason = "mock pinecone server not running on :5080";
      break;
  }
  prereqCache.set(prereq, reason);
  return reason;
}

// ── execution ────────────────────────────────────────────────────────────

function scriptFile(entry: SmokeEntry): string {
  return `scripts/smoke/${entry.file ?? `${entry.id}.ts`}`;
}

function runScript(entry: SmokeEntry, base: string, timeoutMs: number): Promise<Result> {
  const rel = scriptFile(entry);
  const isMjs = rel.endsWith(".mjs");
  const cmd = isMjs ? process.execPath : "npx";
  const args = isMjs ? [rel] : ["tsx", rel];
  const started = Date.now();

  return new Promise<Result>((done) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, BASE_URL: base },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { out += chunk.toString(); });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      const lines = out.split("\n").map((l) => l.trimEnd()).filter(Boolean);
      const summary = lines.length ? lines[lines.length - 1] : "(no output)";
      const verdict: Verdict = timedOut ? "timeout" : exitCode === 0 ? "pass" : "fail";
      done({
        id: entry.id,
        group: entry.group,
        verdict,
        ms: Date.now() - started,
        exitCode,
        summary: timedOut ? `timed out after ${timeoutMs}ms` : summary,
        note: entry.note,
        outputTail: lines.slice(-40),
      });
    };

    child.on("error", (err) => {
      out += `\nspawn error: ${String(err)}`;
      finish(1);
    });
    child.on("close", (code) => finish(code));
  });
}

async function runPool(entries: SmokeEntry[], parallel: number, runner: (e: SmokeEntry) => Promise<Result>, onDone: (r: Result) => void): Promise<Result[]> {
  const results: Result[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(parallel, entries.length) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      const result = await runner(entry);
      results.push(result);
      onDone(result);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── reporting ────────────────────────────────────────────────────────────

const ICON: Record<Verdict, string> = { pass: "✅", fail: "❌", skip: "⏭️", timeout: "⏰" };

function formatResult(r: Result): string {
  const secs = `${(r.ms / 1000).toFixed(1)}s`;
  const detail = r.verdict === "pass" ? "" : ` ${r.summary}`;
  return `${ICON[r.verdict]} [${r.group}] ${r.id} (${secs})${detail}`;
}

function markdown(results: Result[], base: string, startedAt: Date): string {
  const totals = count(results);
  const rows = results.map((r) => `| ${ICON[r.verdict]} | \`${r.group}\` | \`${r.id}\` | ${(r.ms / 1000).toFixed(1)}s | ${r.summary.replace(/\|/g, "\\|")} |`);
  const failed = results.filter((r) => r.verdict === "fail" || r.verdict === "timeout");
  const details = failed
    .map((r) => `### ${r.id}\n\n\`\`\`\n${r.outputTail.join("\n")}\n\`\`\``)
    .join("\n\n");
  return [
    `# 验收 smoke 套件报告`,
    "",
    `- 时间：${startedAt.toISOString()}`,
    `- 服务地址：${base}`,
    `- 结果：通过 ${totals.pass} / 失败 ${totals.fail + totals.timeout} / 跳过 ${totals.skip}（共 ${results.length}）`,
    "",
    "| 状态 | 分组 | 脚本 | 耗时 | 摘要 |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    ...(details ? ["## 失败详情", "", details] : []),
  ].join("\n");
}

function count(results: Result[]): Record<Verdict, number> {
  return {
    pass: results.filter((r) => r.verdict === "pass").length,
    fail: results.filter((r) => r.verdict === "fail").length,
    timeout: results.filter((r) => r.verdict === "timeout").length,
    skip: results.filter((r) => r.verdict === "skip").length,
  };
}

// ── admin user-tier elevation (see --elevate) ────────────────────────────
// The in-route user tier (chat + API-key routes) resolves its limit from the
// admin store, whose demo default is 60/min (src/lib/admin/store.ts). A run
// that shares one server window therefore 429s itself even when
// RATE_LIMIT_PER_MIN is raised, so the runner can temporarily raise the
// admin-store value and put it back when the run finishes.

async function loginOwner(base: string): Promise<string | null> {
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@knowledgeai.dev", password: DEMO_PASSWORD }),
    });
    const data = (await res.json().catch(() => null)) as { token?: string } | null;
    return data?.token ?? null;
  } catch {
    return null;
  }
}

async function readAdminBaseLimit(base: string, token: string): Promise<number | null> {
  try {
    const res = await fetch(`${base}/api/admin/ratelimit`, { headers: { Cookie: `kai-token=${token}` } });
    const data = (await res.json().catch(() => null)) as { limits?: { base?: number } } | null;
    return typeof data?.limits?.base === "number" ? data.limits.base : null;
  } catch {
    return null;
  }
}

async function setAdminBaseLimit(base: string, token: string, value: number): Promise<boolean> {
  try {
    const res = await fetch(`${base}/api/admin/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: `kai-token=${token}` },
      body: JSON.stringify({ rateLimitPerMin: value }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (process.env.SMOKE_TIMEOUT_MS) process.env.SMOKE_TIMEOUT_MS = process.env.SMOKE_TIMEOUT_MS;

  if (opts.list) {
    for (const e of SMOKE_MANIFEST) console.log(`${e.group.padEnd(6)} ${e.id}${e.file ? ` (${e.file})` : ""}`);
    return;
  }

  const base = resolveSmokeBase();
  const matches = (id: string, patterns: string[]) => patterns.length === 0 || patterns.some((p) => id.includes(p));
  const entries = SMOKE_MANIFEST.filter(
    (e) => opts.groups.includes(e.group) && matches(e.id, opts.only) && !opts.skip.some((p) => e.id.includes(p))
  );
  if (entries.length === 0) throw new Error("no scripts selected - check --group/--only/--skip");

  console.log(`smoke runner: ${entries.length} script(s) | groups=${opts.groups.join(",")} | base=${base} | parallel=${opts.parallel}`);
  const startedAt = new Date();
  const results: Result[] = [];

  // Preflight: the http/ui groups need a live server; without it every script
  // would spend its whole timeout failing to connect.
  const needsServer = entries.some((e) => e.group === "http" || e.group === "limits" || e.group === "ui");
  let serverUp = true;
  if (needsServer) {
    serverUp = await reachable(`${base}/api/health`, 5000);
    if (!serverUp) console.error(`\n⚠️  no dev server at ${base} - http/ui scripts will be reported as failures. Start it with \`pnpm dev\`.\n`);
  }

  // `limits` asserts the documented default tiers - elevating the user tier
  // would hide the regressions it exists to catch, so refuse the combination
  // rather than silently invalidating the run.
  if (opts.elevate && opts.groups.includes("limits")) {
    throw new Error("--elevate cannot be combined with the `limits` group (it needs the documented default tiers)");
  }

  let elevateToken: string | null = null;
  let elevatePrev: number | null = null;
  if (opts.elevate && serverUp) {
    elevateToken = await loginOwner(base);
    if (!elevateToken) {
      console.error("⚠️  --elevate: owner login failed - running with the server's current limits.\n");
    } else {
      elevatePrev = await readAdminBaseLimit(base, elevateToken);
      const ok = await setAdminBaseLimit(base, elevateToken, opts.elevate);
      if (!ok) {
        console.error("⚠️  --elevate: PATCH /api/admin/config failed - running with the server's current limits.\n");
        elevateToken = null;
      } else {
        console.log(`smoke runner: admin user tier raised to ${opts.elevate}${elevatePrev ? ` (was ${elevatePrev})` : ""}`);
      }
    }
  }

  const runEntry = async (entry: SmokeEntry): Promise<Result> => {
    if ((entry.group === "http" || entry.group === "limits" || entry.group === "ui") && !serverUp) {
      return { id: entry.id, group: entry.group, verdict: "fail", ms: 0, exitCode: null, summary: `dev server unreachable at ${base}`, outputTail: [] };
    }
    for (const pre of entry.prereq ?? []) {
      const reason = await missingPrereq(pre);
      if (reason) {
        return { id: entry.id, group: entry.group, verdict: "skip", ms: 0, exitCode: null, summary: `SKIP (${reason})`, note: entry.note, outputTail: [] };
      }
    }
    const envTimeout = Number(process.env.SMOKE_TIMEOUT_MS ?? 0);
    const timeoutMs = entry.timeoutMs ?? (envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS);
    return runScript(entry, base, timeoutMs);
  };

  const done: Result[] = await runPool(entries, opts.parallel, runEntry, (r) => {
    console.log(formatResult(r));
    if (r.verdict === "fail" || r.verdict === "timeout") {
      for (const line of r.outputTail.slice(-12)) console.log(`    │ ${line}`);
    }
  });
  results.push(...done);

  if (elevateToken && elevatePrev !== null) {
    const restored = await setAdminBaseLimit(base, elevateToken, elevatePrev);
    console.log(`smoke runner: admin user tier restored to ${elevatePrev}${restored ? "" : " - RESTORE FAILED"}`);
  }

  const totals = count(results);
  const failures = totals.fail + totals.timeout;
  console.log(
    `\nsmoke summary: ${totals.pass} passed, ${failures} failed, ${totals.skip} skipped (${results.length} total, ${((Date.now() - startedAt.getTime()) / 1000).toFixed(0)}s)`
  );

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const jsonPath = opts.json ?? join(REPORT_DIR, `smoke-${stamp}.json`);
  const mdPath = jsonPath.replace(/\.json$/, ".md");
  writeFileSync(jsonPath, JSON.stringify({ startedAt: startedAt.toISOString(), base, groups: opts.groups, totals, results }, null, 2));
  writeFileSync(mdPath, markdown(results, base, startedAt));
  console.log(`report: ${jsonPath}`);

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`smoke runner failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
