-- M-7: persist per-KB member role overrides (P4-2) on the Team row.
-- Previously setKbMemberRole() only wrote kbAccess to the DB - the
-- kbMemberRoles map stayed memory-only and every restart silently dropped
-- the overrides (permission drift: roles reverted to the KB-wide default).
ALTER TABLE "Team" ADD COLUMN "kbMemberRoles" JSONB NOT NULL DEFAULT '{}';
