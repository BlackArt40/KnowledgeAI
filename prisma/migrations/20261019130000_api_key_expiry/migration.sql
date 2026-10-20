-- P2: API keys become one-way hashed + time-limited.
-- Existing rows keep expiresAt = NULL (never expire) until rotated.

ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
