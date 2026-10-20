-- P0: persist security state (2FA / sessions / login history / privacy).
-- Mirrors prisma/migrations/20261019120000_user_security_state.
-- Flyway baseline is 17; V18 (usage metering) precedes this migration.

CREATE TABLE IF NOT EXISTS "UserSecurity" (
    "userId" TEXT NOT NULL,
    "twoFactor" JSONB NOT NULL DEFAULT '{}',
    "sessions" JSONB NOT NULL DEFAULT '[]',
    "loginHistory" JSONB NOT NULL DEFAULT '[]',
    "privacy" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSecurity_pkey" PRIMARY KEY ("userId")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UserSecurity_userId_fkey'
    ) THEN
        ALTER TABLE "UserSecurity" ADD CONSTRAINT "UserSecurity_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
