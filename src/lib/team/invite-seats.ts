// Pending-invite seat reservations.
//
// Invitations are stateless signed tokens; to keep the plan's seat budget from
// being overbooked by parallel invites we keep a reservation per
// (workspace, email) until the invite is accepted/rejected (or expires).
// Accepting converts the reservation into a workspace member (net-zero seats).
//
// The in-memory map is the read cache; every mutation is written through to
// PostgreSQL (TeamInviteReservation) and hydrated on boot, so reservations
// survive restarts in DB deployments.
import {
  deleteInviteReservation,
  persistInviteReservation,
} from "@/lib/db/persist";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Reservation {
  email: string;
  workspaceId: string;
  role: string;
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
    if (r.expiresAt <= now) {
      store().delete(k);
      void deleteInviteReservation(r.workspaceId, r.email);
    }
  }
}

export function reserveInviteSeat(
  workspaceId: string,
  email: string,
  role: string = "viewer",
  expiresAt: number = Date.now() + TTL_MS
): void {
  const reservation: Reservation = {
    email: email.trim().toLowerCase(),
    workspaceId,
    role,
    expiresAt,
  };
  store().set(key(workspaceId, email), reservation);
  void persistInviteReservation(reservation);
}

export function releaseInviteSeat(workspaceId: string, email: string): void {
  store().delete(key(workspaceId, email));
  void deleteInviteReservation(workspaceId, email.trim().toLowerCase());
}

/** Merge a DB row into the cache (boot hydration); expired rows are skipped. */
export function hydrateInviteReservation(row: {
  workspaceId: string;
  email: string;
  role: string;
  expiresAt: number;
}): void {
  if (row.expiresAt <= Date.now()) return;
  store().set(key(row.workspaceId, row.email), {
    email: row.email.trim().toLowerCase(),
    workspaceId: row.workspaceId,
    role: row.role,
    expiresAt: row.expiresAt,
  });
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
