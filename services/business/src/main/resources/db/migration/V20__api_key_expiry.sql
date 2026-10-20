-- P2: API keys become one-way hashed + time-limited.
-- Mirrors prisma/migrations/20261019130000_api_key_expiry.

ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
