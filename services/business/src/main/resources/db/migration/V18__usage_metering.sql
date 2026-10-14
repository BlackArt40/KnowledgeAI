-- V18：问答/Agent 用量计量（阶段 4 工作包 4.5，service-split.md）。
-- 本迁移是 Flyway 接管迁移治理后的第一个新迁移（baseline 版本 17 =
-- 现有 Prisma 迁移数）；此后新表一律由 Flyway 产出（ADR-0009 决策 1）。
-- 计量口径与现网 billing/store.ts 的 usageByWorkspace 对齐：按 workspace 按日聚合。
CREATE TABLE IF NOT EXISTS "UsageDaily" (
  "workspaceId" text    NOT NULL,
  "day"         date    NOT NULL,
  "qaCount"     bigint  NOT NULL DEFAULT 0,
  "agentCount"  bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY ("workspaceId", "day")
);
