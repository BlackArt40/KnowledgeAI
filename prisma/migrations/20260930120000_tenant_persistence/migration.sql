-- 2026-09-30 engineering-assurance: tenant ownership must survive a restart.
--
--   KnowledgeBase.workspaceId - was a memory-only field, so `hydrateKb` had to
--   hard-code 'ws_default'. Any KB created in another workspace was therefore
--   merged into the default workspace on every restart / second replica, where
--   the default workspace's members could read it (finding F3 / debt A3).
--
--   Workspace.members - was memory-only too, so re-hydrated workspaces came
--   back with an empty member list (debt A4 / finding D2).
--
-- Both columns are additive with safe defaults, so existing rows keep the
-- previous behaviour ('ws_default' / no members) and older application
-- versions still read the table (forward-compatible deploy).

-- AlterTable
ALTER TABLE "KnowledgeBase" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'ws_default';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "members" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
