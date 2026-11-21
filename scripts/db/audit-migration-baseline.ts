#!/usr/bin/env node
// Database migration baseline audit (read-only by default).
//
// 背景：2026-11-20 拆分线退役后，Flyway 目录已删除，Prisma 成为唯一迁移
// 来源。历史库可能由 Flyway V1-V21 建表，没有 `_prisma_migrations` 记录；
// 直接 `prisma migrate deploy` 会因表已存在而失败。
//
// 本脚本只读检查：
//   1. `_prisma_migrations` 是否存在，已应用/待应用/失败迁移
//   2. `flyway_schema_history` 是否存在，版本、成功/失败记录
//   3. 两者是否可以按 FLYWAY_TO_PRISMA 映射对齐
//   4. `prisma migrate diff` 是否仍有 schema 漂移
//
// 默认只打印建议，不写数据库。显式 `--apply` 且 `BASELINE_APPLY=1` 时才会：
//   - 对 Flyway 已覆盖的 Prisma 迁移执行 `migrate resolve --applied`
//   - 再执行 `migrate deploy` 应用剩余 5 个迁移
// 执行前必须自行备份数据库。
//
// 用法：
//   pnpm db:baseline                 # 只读审计（无 DATABASE_URL 则 SKIP）
//   pnpm db:baseline --apply         # 写迁移历史（需 BASELINE_APPLY=1）
//   pnpm db:baseline --json          # 机器可读摘要
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "prisma", "migrations");
const SCHEMA = join(ROOT, "prisma", "schema.prisma");

/** Flyway 版本 -> 对应的 Prisma 迁移目录（V1-V21，拆分线删除前）。 */
export const FLYWAY_TO_PRISMA: Record<string, string> = {
  "1": "20260713022119_init",
  "2": "20260804180000_p2_3_report_enhance",
  "3": "20260805080000_p3_1_2fa_enforce",
  "4": "20260810090000_p3_4_audit",
  "5": "20260811000000_p5_3_conversation_feedback",
  "6": "20260811010000_p5_4_user_locale",
  "7": "20260811120000_p5_5_workspace_brand_color",
  "8": "20260812090000_p7_1_webhook_subscriptions",
  "9": "20260812100000_p7_2_bot_integrations",
  "10": "20260812110000_p7_3_knowledge_graph",
  "11": "20260813090000_p3_2_oauth_links",
  "12": "20260814045956_agent_task_extended",
  "13": "20260816100000_drop_dead_tables",
  "14": "20260820230000_m7_kb_member_roles",
  "15": "20260828090000_password_reset",
  "16": "20260828100000_email_verification",
  "17": "20260930120000_tenant_persistence",
  "18": "20261019140000_usage_daily",
  "19": "20261019120000_user_security_state",
  "20": "20261019130000_api_key_expiry",
  "21": "20261019150000_user_usage_daily",
};

interface PrismaAppliedRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

interface FlywayRow {
  version: string | null;
  description: string;
  success: boolean;
}

interface Audit {
  target: string;
  hasPrismaHistory: boolean;
  hasFlywayHistory: boolean;
  prismaApplied: string[];
  prismaPending: string[];
  prismaFailed: PrismaAppliedRow[];
  flywayRows: FlywayRow[];
  missingMapped: string[];
  unknownFlywayVersions: string[];
  drift: "none" | "ignored" | "drift" | "unknown";
  driftDetail?: string;
}

function log(msg: string): void {
  console.log(`[db:baseline] ${msg}`);
}

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((d) => statSync(join(MIGRATIONS, d)).isDirectory())
    .sort();
}

function sanitize(url: string): string {
  return url.replace(/\/\/[^@]+@/, "//***@");
}

/** 去掉 diff 的 `--` 注释与空行，便于判断是否只剩 flyway 历史表。 */
function diffBody(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("--"))
    .join("\n");
}

/**
 * 运行期由应用管理的表，不属于 Prisma schema，但也不能删除：
 * - flyway_schema_history：拆分线历史记录，按规程保留；
 * - kb_chunks：pgvector 向量表，由 src/lib/rag/vector-store-pgvector.ts 创建。
 */
const RUNTIME_TABLES = ["flyway_schema_history", "kb_chunks"];

function stripRuntimeTables(sql: string): string {
  let body = diffBody(sql);
  for (const table of RUNTIME_TABLES) {
    const re = new RegExp(`DROP TABLE (IF EXISTS )?(?:"?[A-Za-z0-9_]+"?\\.)?"?${table}"?;`, "gi");
    body = body.replace(re, "");
  }
  return body.trim();
}

/**
 * `migrate diff` 会把运行期表视为“多余表”。只删除这些表的差异不算漂移，
 * 但任何其他 DDL 仍必须报告。
 */
function classifyDrift(status: number, stdout: string): Audit["drift"] {
  if (status === 0) return "none";
  if (status !== 2) return "unknown";
  return stripRuntimeTables(stdout) ? "drift" : "ignored";
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): number {
  try {
    execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", env });
    return 0;
  } catch (err) {
    const code = (err as { status?: number }).status;
    return typeof code === "number" ? code : 1;
  }
}

function runCapture(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, { cwd: ROOT, encoding: "utf-8", env });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: typeof e.status === "number" ? e.status : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

async function hasTable(prisma: import("@prisma/client").PrismaClient, name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `select to_regclass($1) is not null as exists`,
    name
  );
  return Boolean(rows[0]?.exists);
}

async function audit(url: string): Promise<Audit> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const dirs = migrationDirs();
    const hasPrismaHistory = await hasTable(prisma, "_prisma_migrations");
    const hasFlywayHistory = await hasTable(prisma, "flyway_schema_history");

    let prismaApplied: string[] = [];
    let prismaFailed: PrismaAppliedRow[] = [];
    if (hasPrismaHistory) {
      const rows = await prisma.$queryRawUnsafe<PrismaAppliedRow[]>(
        `select migration_name, finished_at, rolled_back_at
           from _prisma_migrations
          order by started_at`
      );
      prismaApplied = rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
      prismaFailed = rows.filter((r) => !r.finished_at || r.rolled_back_at);
    }

    let flywayRows: FlywayRow[] = [];
    if (hasFlywayHistory) {
      flywayRows = await prisma.$queryRawUnsafe<FlywayRow[]>(
        `select version, description, success
           from flyway_schema_history
          order by installed_rank`
      );
    }

    const appliedSet = new Set(prismaApplied);
    const prismaPending = dirs.filter((d) => !appliedSet.has(d));
    const missingMapped = flywayRows
      .filter((r) => r.success && r.version)
      .map((r) => FLYWAY_TO_PRISMA[r.version as string])
      .filter((name): name is string => Boolean(name) && !appliedSet.has(name));
    const unknownFlywayVersions = flywayRows
      .filter((r) => r.version && !FLYWAY_TO_PRISMA[r.version])
      .map((r) => r.version as string);

    let drift: Audit["drift"] = "unknown";
    let driftDetail = "";
    // 用 --from-schema-datasource 读取 DATABASE_URL，避免把连接串放进 argv
    // （ps/CI 日志会看到密码）。目标库通过环境变量传入。
    const diff = runCapture(
      "npx",
      [
        "prisma",
        "migrate",
        "diff",
        "--from-schema-datasource",
        SCHEMA,
        "--to-schema-datamodel",
        SCHEMA,
        "--script",
        "--exit-code",
      ],
      { ...process.env, DATABASE_URL: url }
    );
    drift = classifyDrift(diff.status, diff.stdout);
    if (drift === "drift" || drift === "unknown") {
      driftDetail = (diff.stdout || diff.stderr).trim().split("\n").slice(0, 5).join(" | ").slice(0, 600);
    }

    return {
      target: sanitize(url),
      hasPrismaHistory,
      hasFlywayHistory,
      prismaApplied,
      prismaPending,
      prismaFailed,
      flywayRows,
      missingMapped,
      unknownFlywayVersions,
      drift,
      driftDetail,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function printReport(a: Audit): void {
  log(`target: ${a.target}`);
  log(`migration dirs: ${migrationDirs().length}`);
  log(`_prisma_migrations: ${a.hasPrismaHistory ? `${a.prismaApplied.length} applied` : "absent"}`);
  if (a.hasPrismaHistory) {
    if (a.prismaFailed.length) log(`  ✖ failed/rolled-back: ${a.prismaFailed.map((r) => r.migration_name).join(", ")}`);
    if (a.prismaPending.length) log(`  pending: ${a.prismaPending.join(", ")}`);
    else log("  ✔ all migration dirs recorded as applied");
  }
  log(`flyway_schema_history: ${a.hasFlywayHistory ? `${a.flywayRows.length} rows` : "absent"}`);
  if (a.hasFlywayHistory) {
    const failed = a.flywayRows.filter((r) => !r.success);
    if (failed.length) log(`  ✖ failed: ${failed.map((r) => r.version ?? "?").join(", ")}`);
    if (a.unknownFlywayVersions.length) log(`  ✖ unknown versions: ${a.unknownFlywayVersions.join(", ")}`);
  }
  if (a.drift === "ignored") {
    log(`drift: none（忽略运行期表：${RUNTIME_TABLES.join(" / ")}）`);
  } else {
    log(`drift: ${a.drift}${a.driftDetail ? ` (${a.driftDetail})` : ""}`);
  }

  if (!a.hasPrismaHistory && a.hasFlywayHistory) {
    log("baseline needed: DB was created by Flyway; Prisma history is absent");
    log(`will mark ${a.missingMapped.length} mapped migration(s) as applied, then deploy the rest`);
    for (const name of a.missingMapped) log(`  npx prisma migrate resolve --applied ${name}`);
    log("  npx prisma migrate deploy");
  } else if (a.hasPrismaHistory && a.prismaPending.length) {
    log("Prisma history exists but migrations are pending:");
    log("  npx prisma migrate deploy");
  } else if (!a.hasPrismaHistory && !a.hasFlywayHistory) {
    log("no migration history found: this is an empty database");
    log("  npx prisma migrate deploy");
  } else {
    log("✔ history present; no baseline action required");
  }
  if (a.drift === "drift") log("schema still drifts from prisma/schema.prisma: review before deploying");
}

function applyBaseline(a: Audit, url: string): void {
  if (process.env.BASELINE_APPLY !== "1") {
    throw new Error("写基线需要显式 BASELINE_APPLY=1（先备份数据库）");
  }
  if (a.hasPrismaHistory) {
    throw new Error("已存在 _prisma_migrations，拒绝自动 resolve；请人工核对后再执行");
  }
  if (!a.hasFlywayHistory) {
    throw new Error("没有 flyway_schema_history，无法判断历史迁移覆盖范围");
  }
  if (a.flywayRows.some((r) => !r.success)) {
    throw new Error("flyway_schema_history 含失败记录，先修复");
  }
  if (a.unknownFlywayVersions.length) {
    throw new Error(`存在未映射的 Flyway 版本: ${a.unknownFlywayVersions.join(", ")}`);
  }
  for (const name of a.missingMapped) {
    log(`resolve --applied ${name}`);
    const code = run("npx", ["prisma", "migrate", "resolve", "--applied", name, "--schema", SCHEMA], {
      ...process.env,
      DATABASE_URL: url,
    });
    if (code !== 0) throw new Error(`resolve failed: ${name}`);
  }
  log("deploy remaining migrations");
  const code = run("npx", ["prisma", "migrate", "deploy", "--schema", SCHEMA], {
    ...process.env,
    DATABASE_URL: url,
  });
  if (code !== 0) throw new Error("migrate deploy failed");
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const apply = process.argv.includes("--apply");
  const url = process.env.BASELINE_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!url) {
    log("SKIP: DATABASE_URL / BASELINE_DATABASE_URL 未配置（本机无数据库时预期如此）");
    return;
  }

  const a = await audit(url);
  if (json) {
    console.log(JSON.stringify(a, null, 2));
  } else {
    printReport(a);
  }

  if (apply) {
    applyBaseline(a, url);
    log("baseline applied; rerun without --apply to verify");
  }
}

// 仅直接运行时执行；被测试 import 时不触发审计。
if (process.argv[1]?.endsWith("audit-migration-baseline.ts")) {
  void main().catch((err) => {
    console.error(`[db:baseline] ERROR: ${(err as Error).message}`);
    process.exit(1);
  });
}
