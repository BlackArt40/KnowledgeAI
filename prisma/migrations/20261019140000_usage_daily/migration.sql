-- P1/P2: workspace daily usage counters (quota/alert source of truth).
-- Mirrors the Java Flyway V18 migration; IF NOT EXISTS keeps both migration
-- systems safe on a shared database.

CREATE TABLE IF NOT EXISTS "UsageDaily" (
    "workspaceId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "qaCount" BIGINT NOT NULL DEFAULT 0,
    "agentCount" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "UsageDaily_pkey" PRIMARY KEY ("workspaceId", "day")
);
