-- P0: persist security state (2FA / sessions / login history / privacy).
-- Previously memory-only: a restart silently disabled 2FA for every user.

-- CreateTable
CREATE TABLE "UserSecurity" (
    "userId" TEXT NOT NULL,
    "twoFactor" JSONB NOT NULL DEFAULT '{}',
    "sessions" JSONB NOT NULL DEFAULT '[]',
    "loginHistory" JSONB NOT NULL DEFAULT '[]',
    "privacy" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSecurity_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserSecurity" ADD CONSTRAINT "UserSecurity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
