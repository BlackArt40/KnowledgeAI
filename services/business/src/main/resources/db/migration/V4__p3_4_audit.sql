-- P3-4: append-only security audit trail with a tamper-evident hash chain.
-- Each row links to the previous one via prevHash; hash is
-- HMAC-SHA256(prevHash|actorId|actor|action|target|detail|ip|createdAt, AUTH_SECRET).
-- Rows are trimmed by AUDIT_RETENTION_DAYS (see src/lib/security/audit.ts).

-- CreateTable
CREATE TABLE "SecurityAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actor" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT '',
    "detail" TEXT NOT NULL,
    "ip" TEXT,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityAudit_action_idx" ON "SecurityAudit"("action");

-- CreateIndex
CREATE INDEX "SecurityAudit_createdAt_idx" ON "SecurityAudit"("createdAt");
