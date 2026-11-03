-- Pending team-invite seat reservations (strong consistency across restarts).
CREATE TABLE "TeamInviteReservation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInviteReservation_pkey" PRIMARY KEY ("id")
);

-- One reservation per (workspace, invitee email).
CREATE UNIQUE INDEX "TeamInviteReservation_workspaceId_email_key" ON "TeamInviteReservation"("workspaceId", "email");

-- Expiry sweep / hydration filter.
CREATE INDEX "TeamInviteReservation_expiresAt_idx" ON "TeamInviteReservation"("expiresAt");
