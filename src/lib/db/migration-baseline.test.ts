import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FLYWAY_TO_PRISMA } from "../../../scripts/db/audit-migration-baseline";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");

function prismaMigrations(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((d) => statSync(join(MIGRATIONS, d)).isDirectory())
    .sort();
}

describe("Flyway → Prisma 迁移基线映射", () => {
  it("覆盖 Flyway V1-V21 且每个版本都指向真实 Prisma 迁移目录", () => {
    const dirs = new Set(prismaMigrations());
    for (let v = 1; v <= 21; v += 1) {
      const name = FLYWAY_TO_PRISMA[String(v)];
      expect(name, `V${v} 缺少映射`).toBeTruthy();
      expect(dirs.has(name), `V${v} -> ${name} 目录不存在`).toBe(true);
    }
    expect(new Set(Object.values(FLYWAY_TO_PRISMA)).size).toBe(21);
  });

  it("保留 Flyway 未覆盖的 5 个 Prisma 迁移", () => {
    const mapped = new Set(Object.values(FLYWAY_TO_PRISMA));
    const remaining = prismaMigrations().filter((d) => !mapped.has(d));
    expect(remaining).toEqual([
      "20261030120000_document_access",
      "20261102120000_notification_team_activity",
      "20261103120000_team_invite_reservation",
      "20261104120000_document_version",
      "20261119120000_tenant_indexes_owner_cascade",
    ]);
  });
});
