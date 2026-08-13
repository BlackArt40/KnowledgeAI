-- P7-2: chat-bot integrations (Slack / 飞书 / 钉钉). One row per bot binding
-- tying a KB to a platform webhook endpoint. The callback token is stored
-- SHA-256-hashed (tokenHash) - never plaintext. Each bot is rate-limited by
-- its own integration tier. See src/lib/integrations/bots.ts.

-- CreateTable
CREATE TABLE "BotIntegration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'ws_default',
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kbId" TEXT NOT NULL,
    "kbName" TEXT NOT NULL DEFAULT '',
    "tokenHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotIntegration_workspaceId_idx" ON "BotIntegration"("workspaceId");
