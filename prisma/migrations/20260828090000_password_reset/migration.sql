-- P8: password reset flow.
-- Stores only the SHA-256 hash of the raw reset token (never the token
-- itself) plus an expiry; the token is single-use and cleared on reset.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordResetTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetExpires" TIMESTAMP(3);