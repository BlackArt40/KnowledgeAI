-- P8: email verification flow.
-- Follows the password-reset token hygiene: only the SHA-256 hash of the raw
-- verification token is stored, plus an expiry. emailVerifiedAt is set once
-- the user validates their inbox, the token itself is single-use.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "verificationTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "verificationExpires" TIMESTAMP(3);