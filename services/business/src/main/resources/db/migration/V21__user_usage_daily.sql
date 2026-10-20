-- P1/P2: per-user daily usage counters (billing page + admin monthly totals).
-- Mirrors prisma/migrations/20261019150000_user_usage_daily.

CREATE TABLE IF NOT EXISTS "UserUsageDaily" (
  "userId"     text   NOT NULL,
  "day"        date   NOT NULL,
  "qaCount"    bigint NOT NULL DEFAULT 0,
  "apiCount"   bigint NOT NULL DEFAULT 0,
  "agentCount" bigint NOT NULL DEFAULT 0,
  PRIMARY KEY ("userId", "day")
);
