-- P2-3 Report Enhancement: add share config, revision history, and comments
-- to AgentTask (all optional JSON columns).
ALTER TABLE "AgentTask" ADD COLUMN "shareConfig" JSONB;
ALTER TABLE "AgentTask" ADD COLUMN "versions" JSONB;
ALTER TABLE "AgentTask" ADD COLUMN "comments" JSONB;
