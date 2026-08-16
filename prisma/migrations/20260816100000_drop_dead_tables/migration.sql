-- Drop dead tables: TeamInvite and Session were defined in the initial
-- migration but never referenced by any code path (team invites persist as
-- TeamMember rows with status "invited"; sessions are stateless jose JWTs).
DROP TABLE IF EXISTS "TeamInvite";
DROP TABLE IF EXISTS "Session";
