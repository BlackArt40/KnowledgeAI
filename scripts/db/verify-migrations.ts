#!/usr/bin/env node
// Batch 3: migration replay. CI already runs `prisma migrate diff --exit-code`
// (schema.prisma vs migrations), which catches *drift* but never proves the
// migrations actually apply to an empty database, nor that a destructive
// statement was reviewed.
//
// Steps:
//   1. `prisma migrate deploy`  - full replay, newest migration last
//   2. `prisma migrate diff`    - the datamodel and the replayed DB must match
//   3. statement scan           - DROP TABLE/COLUMN + TRUNCATE must be allowlisted
//
// Requires DATABASE_URL; without it the script prints SKIP and exits 0 (same
// convention as the smoke suite's infra group).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCHEMA = join(ROOT, "prisma", "schema.prisma");
const MIGRATIONS = join(ROOT, "prisma", "migrations");

/**
 * Destructive migrations that were reviewed and are safe to replay. Key =
 * migration directory, value = why it is acceptable.
 */
const DESTRUCTIVE_ALLOWLIST: Record<string, string> = {
  "20260816100000_drop_dead_tables":
    "P7 清理：删除从未写入的遗留表（与 schema.prisma 同步移除），空库重放时无数据损失",
};

function log(msg: string): void {
  console.log(`[verify-migrations] ${msg}`);
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: process.env });
}

function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((d) => statSync(join(MIGRATIONS, d)).isDirectory())
    .sort();
}

function findDestructive(): { migration: string; statements: string[] }[] {
  const hits: { migration: string; statements: string[] }[] = [];
  for (const dir of migrationDirs()) {
    const file = join(MIGRATIONS, dir, "migration.sql");
    let sql = "";
    try {
      sql = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const statements = sql
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^(DROP\s+(TABLE|COLUMN)|TRUNCATE)\b/i.test(l));
    if (statements.length > 0) hits.push({ migration: dir, statements });
  }
  return hits;
}

function main(): void {
  if (!process.env.DATABASE_URL) {
    log("SKIP: DATABASE_URL 未配置（CI quality job 提供 postgres service 时会执行）");
    return;
  }

  log(`1/3 replay ${migrationDirs().length} migrations onto the target database`);
  run("npx", ["prisma", "migrate", "deploy", "--schema", SCHEMA]);

  log("2/3 compare replayed database against schema.prisma");
  run("npx", [
    "prisma",
    "migrate",
    "diff",
    "--from-url",
    process.env.DATABASE_URL,
    "--to-schema-datamodel",
    SCHEMA,
    "--exit-code",
  ]);

  log("3/3 scan migrations for destructive statements");
  const destructive = findDestructive();
  const unlisted = destructive.filter((d) => !(d.migration in DESTRUCTIVE_ALLOWLIST));
  if (unlisted.length > 0) {
    for (const hit of unlisted) {
      console.error(`  ✖ ${hit.migration}: ${hit.statements.join(" | ")}`);
    }
    console.error(
      "破坏性语句必须先评审，再登记到 scripts/db/verify-migrations.ts 的 DESTRUCTIVE_ALLOWLIST（附理由）"
    );
    process.exit(1);
  }
  for (const hit of destructive) {
    log(`  ✔ allowlisted ${hit.migration} — ${DESTRUCTIVE_ALLOWLIST[hit.migration]}`);
  }

  log("OK");
}

main();
