-- P1/P2: per-user daily usage counters (billing page + admin monthly totals).

CREATE TABLE IF NOT EXISTS "UserUsageDaily" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "qaCount" BIGINT NOT NULL DEFAULT 0,
    "apiCount" BIGINT NOT NULL DEFAULT 0,
    "agentCount" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "UserUsageDaily_pkey" PRIMARY KEY ("userId", "day")
);
