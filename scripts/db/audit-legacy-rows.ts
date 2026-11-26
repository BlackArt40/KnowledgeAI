#!/usr/bin/env node
// Legacy-row audit (read-only). Decides whether the data-dependent compat
// branches in `src/lib` can be removed.
//
// Why: several code paths exist only to keep pre-migration rows working:
//   - `auth/store.ts`  `passwordMatches()` accepts unsalted SHA-256 (seed /
//     pre-P3-4 rows) next to PBKDF2
//   - `apikeys/store.ts` accepts legacy AES-GCM ciphertext and pre-P3-4
//     plaintext next to `sha256$<hex>`
//   - `User.plan` is `@deprecated` (plan lives on Workspace) but the column
//     still carries historical values
//   - `pnpm db:baseline` (Flyway -> Prisma) is only needed while some deployed
//     database still has `flyway_schema_history`
//
// Those branches cannot be judged from the repo — only from the data. This
// script answers with counts and never writes.
//
// Usage:
//   pnpm db:audit-legacy                 # human summary (SKIP without a DB)
//   pnpm db:audit-legacy --json          # machine-readable
//   BASELINE_DATABASE_URL=postgresql://readonly@host/db pnpm db:audit-legacy
import { PrismaClient } from "@prisma/client";

interface Check {
  id: string;
  label: string;
  /** What becomes safe once this returns 0. */
  unlocks: string;
  sql: string;
  blocking: boolean;
}

const CHECKS: Check[] = [
  {
    id: "legacy-password-hash",
    label: "User.passwordHash 存在且不是 pbkdf2$ 前缀（旧无盐 SHA-256）",
    unlocks: "删除 auth/store.ts 的 legacyHash/passwordMatches 旧分支，并让 seed 改用 PBKDF2",
    sql: `select count(*)::int as n from "User" where "passwordHash" is not null and "passwordHash" not like 'pbkdf2$%'`,
    blocking: true,
  },
  {
    id: "legacy-api-key",
    label: "ApiKey.keyHash 不是 sha256$ 前缀（AES 密文或 pre-P3-4 明文）",
    unlocks: "删除 apikeys/store.ts 的 AES/明文校验分支与 db/persist/apikey.ts 的旧前缀注释",
    sql: `select count(*)::int as n from "ApiKey" where "keyHash" not like 'sha256$%'`,
    blocking: true,
  },
  {
    id: "deprecated-user-plan",
    label: "User.plan 不是 free（@deprecated 列仍带历史值）",
    unlocks: "为删除 User.plan 列准备一次迁移；读取路径已全部走 Workspace.plan",
    sql: `select count(*)::int as n from "User" where plan <> 'free'`,
    blocking: true,
  },
  {
    id: "never-expiring-api-keys",
    label: "ApiKey.expiresAt 为 NULL 的 active 行（legacy 永不返回过期）",
    unlocks: "信息项：可安排轮换回填，不阻塞任何删除",
    sql: `select count(*)::int as n from "ApiKey" where "expiresAt" is null and status = 'active'`,
    blocking: false,
  },
];

interface FlywayState {
  present: boolean;
  rows: number | null;
}

function log(msg: string): void {
  console.log(`[db:audit-legacy] ${msg}`);
}

function sanitize(url: string): string {
  return url.replace(/\/\/[^@]+@/, "//***@");
}

async function flywayState(prisma: PrismaClient): Promise<FlywayState> {
  const rows = await prisma.$queryRawUnsafe<{ present: boolean }[]>(
    `select to_regclass('flyway_schema_history') is not null as present`
  );
  if (!rows[0]?.present) return { present: false, rows: null };
  const count = await prisma.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int as n from flyway_schema_history`);
  return { present: true, rows: count[0]?.n ?? 0 };
}

async function main(): Promise<void> {
  const url = process.env.BASELINE_DATABASE_URL || process.env.DATABASE_URL;
  const json = process.argv.includes("--json");
  if (!url) {
    log("SKIP: DATABASE_URL / BASELINE_DATABASE_URL 未配置（本机无数据库时预期如此）");
    return;
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    log(`target: ${sanitize(url)}`);
    const results: { id: string; label: string; count: number; unlocks: string; blocking: boolean }[] = [];
    for (const c of CHECKS) {
      const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(c.sql);
      results.push({ id: c.id, label: c.label, count: rows[0]?.n ?? 0, unlocks: c.unlocks, blocking: c.blocking });
    }
    const flyway = await flywayState(prisma);

    if (json) {
      console.log(JSON.stringify({ flyway, checks: results }, null, 2));
      return;
    }

    log("");
    for (const r of results) {
      const verdict = r.count === 0 ? "✔ 0 行，可删除对应兼容分支" : `✖ ${r.count} 行，先迁移/轮换`;
      log(`${r.count === 0 ? "✔" : "✖"} ${r.label}: ${r.count}`);
      log(`    ${verdict}${r.blocking ? "" : "（信息项）"} -> ${r.unlocks}`);
    }
    log("");
    log(
      flyway.present
        ? `flyway_schema_history: 存在（${flyway.rows ?? "?"} 行）——db:baseline 仍需要，先走 migration-baseline.md 的收编流程`
        : "flyway_schema_history: 不存在——本库不需要 Flyway 基线；所有已部署库都如此时 db:baseline 可退役"
    );

    const blocking = results.filter((r) => r.blocking && r.count > 0);
    log(
      blocking.length === 0
        ? "\n结论: 数据侧没有阻塞项——兼容分支可以按 PR 逐个删除（先删代码，再回滚风险最低）"
        : `\n结论: ${blocking.length} 项仍有历史行，先迁移数据再删代码`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`[db:audit-legacy] ERROR: ${(err as Error).message}`);
  process.exit(1);
});
