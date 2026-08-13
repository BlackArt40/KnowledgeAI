-- P3-2: OAuth social login - store linked provider identities (Google/GitHub)
-- as a JSON map provider -> providerAccountId on the User row. OAuth-only
-- accounts keep passwordHash NULL (already nullable in the schema).
-- See src/lib/auth/oauth-link.ts.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "oauthLinks" JSONB;
