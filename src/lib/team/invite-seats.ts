// Pending-invite seat reservations.
//
// Invitations are stateless signed tokens; to keep the plan's seat budget from
// being overbooked by parallel invites we keep a small in-memory reservation
// per (workspace, email) until the invite is accepted/rejected (or expires).
// Accepting converts the reservation into a workspace member (net-zero seats).
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Reservation {
  email: string;
  workspaceId: string;
  expiresAt: number;
}

const g = globalThis as unknown as { __KAI_INVITE_SEATS__?: Map<string, Reservation> };

function store(): Map<string, Reservation> {
  if (!g.__KAI_INVITE_SEATS__) g.__KAI_INVITE_SEATS__ = new Map();
  return g.__KAI_INVITE_SEATS__;
}

function key(workspaceId: string, email: string): string {
  return `${workspaceId}:${email.trim().toLowerCase()}`;
}

function prune(now: number) {
  for (const [k, r] of store()) {
    if (r.expiresAt <= now) store().delete(k);
  }
}

export function reserveInviteSeat(
  workspaceId: string,
  email: string,
  expiresAt: number = Date.now() + TTL_MS
): void {
  store().set(key(workspaceId, email), {
    email: email.trim().toLowerCase(),
    workspaceId,
    expiresAt,
  });
}

export function releaseInviteSeat(workspaceId: string, email: string): void {
  store().delete(key(workspaceId, email));
}

/** Emails with a live (unexpired) pending invitation in this workspace. */
export function listPendingInviteEmails(workspaceId: string, now: number = Date.now()): string[] {
  prune(now);
  return [...store().values()]
    .filter((r) => r.workspaceId === workspaceId)
    .map((r) => r.email);
}

export function pendingInviteCount(workspaceId: string, now: number = Date.now()): number {
  return listPendingInviteEmails(workspaceId, now).length;
}
