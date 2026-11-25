// ---------------------------------------------------------------------------
// Persistence - write-through layer that syncs in-memory store mutations
// to PostgreSQL.
//
// Each function is a fire-and-forget async operation:
//   - If DB is enabled: writes to Prisma (errors logged, not thrown)
//   - If DB is not configured: no-op
//
// The in-memory store remains the source of truth for reads. The DB is the
// persistence layer that survives restarts and enables multi-instance in
// future iterations (when stores are migrated to read directly from DB).
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import { getDb, isDbEnabled } from "../prisma";

import { log } from "@/lib/obs/log";

/**
 * Best-effort persistence helper. Deletes are idempotent, so a P2025 ("row not
 * found") is expected and ignored; every other failure is logged. Previously
 * these paths used `.catch((err) => bestEffort(err))`, which silently diverged memory from DB.
 */
import { bestEffort } from "./core";

export async function persistTeam(team: {
  id: string;
  name: string;
  logoInitial: string;
  plan: string;
  kbAccess: Record<string, string>;
  /** M-7: per-KB member role overrides (kbId -> email -> role). */
  kbMemberRoles?: Record<string, Record<string, string>>;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      name: team.name,
      logoInitial: team.logoInitial,
      plan: team.plan,
      kbAccess: team.kbAccess as unknown,
      kbMemberRoles: (team.kbMemberRoles ?? {}) as unknown,
      updatedAt: new Date(),
    };
    const t = db as unknown as {
      team: {
        upsert: (o: unknown) => Promise<unknown>;
      };
    };
    await t.team.upsert({
      where: { id: team.id },
      update: data,
      create: { id: team.id, ...data, createdAt: new Date(team.createdAt) },
    });
  } catch (err) {
    log.error({ err }, "[db] persistTeam error");
  }
}

// ── Workspace (P4-3 tenant / P5-5 brand color) ────────────────────────────

/** Persist (upsert) a workspace row. */


export async function persistAuditEntry(
  entry: { id: string; actor: string; action: string; target: string; detail: string; createdAt: number },
  teamId = "team_default"
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const a = db as unknown as { auditLog: { create: (o: unknown) => Promise<unknown> } };
    await a.auditLog
      .create({
        data: {
          id: entry.id,
          teamId,
          actorId: null,
          actor: entry.actor,
          target: entry.target,
          action: entry.action,
          detail: entry.detail,
          createdAt: new Date(entry.createdAt),
        },
      })
      .catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] persistAuditEntry error");
  }
}

/** Append a SecurityAudit event (P3-4 global audit trail, hash-chained). */


export async function persistAuditEvent(ev: {
  id: string;
  actorId: string | null;
  actor: string;
  action: string;
  target: string;
  detail: string;
  ip: string | null;
  prevHash: string;
  hash: string;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const a = db as unknown as { securityAudit: { create: (o: unknown) => Promise<unknown> } };
    await a.securityAudit.create({
      data: {
        id: ev.id,
        actorId: ev.actorId,
        actor: ev.actor,
        action: ev.action,
        target: ev.target,
        detail: ev.detail,
        ip: ev.ip,
        prevHash: ev.prevHash,
        hash: ev.hash,
        createdAt: new Date(ev.createdAt),
      },
    });
  } catch (err) {
    log.error({ err }, "[db] persistAuditEvent error");
  }
}

/**
 * Best-effort persist of a team member. Resolves userId by email; demo
 * members without a User account are skipped (no FK target).
 */


export async function persistTeamMember(
  member: { id: string; email: string; role: string; joinedAt: number },
  teamId = "team_default"
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const user = await db.user.findUnique({ where: { email: member.email } });
    if (!user) return; // demo-only member, no user account -> skip
    const tm = db as unknown as {
      teamMember: {
        upsert: (o: unknown) => Promise<unknown>;
        delete: (o: unknown) => Promise<unknown>;
      };
    };
    const role = member.role.toUpperCase();
    await tm.teamMember
      .upsert({
        where: { teamId_userId: { teamId, userId: user.id } },
        update: { role: role as never },
        create: {
          id: member.id,
          teamId,
          userId: user.id,
          role: role as never,
          joinedAt: new Date(member.joinedAt),
        },
      })
      .catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] persistTeamMember error");
  }
}

/** Upsert a pending-invite seat reservation (survives restarts). */


export async function persistInviteReservation(reservation: {
  workspaceId: string;
  email: string;
  role: string;
  expiresAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const table = db as unknown as {
      teamInviteReservation: { upsert: (o: unknown) => Promise<unknown> };
    };
    await table.teamInviteReservation
      .upsert({
        where: {
          workspaceId_email: {
            workspaceId: reservation.workspaceId,
            email: reservation.email,
          },
        },
        update: {
          role: reservation.role.toUpperCase() as never,
          expiresAt: new Date(reservation.expiresAt),
        },
        create: {
          id: randomUUID(),
          workspaceId: reservation.workspaceId,
          email: reservation.email,
          role: reservation.role.toUpperCase() as never,
          expiresAt: new Date(reservation.expiresAt),
        },
      })
      .catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] persistInviteReservation error");
  }
}

/** Delete a pending-invite reservation (accept/reject/expiry). */


export async function deleteInviteReservation(
  workspaceId: string,
  email: string
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const table = db as unknown as {
      teamInviteReservation: { deleteMany: (o: unknown) => Promise<unknown> };
    };
    await table.teamInviteReservation
      .deleteMany({ where: { workspaceId, email } })
      .catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteInviteReservation error");
  }
}

/** Delete a team member row (best-effort). */


export async function deleteTeamMemberFromDb(memberId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const tm = db as unknown as { teamMember: { delete: (o: unknown) => Promise<unknown> } };
    await tm.teamMember.delete({ where: { id: memberId } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteTeamMemberFromDb error");
  }
}

// ── Admin: System Config (single-row) ────────────────────────────────────

/** Persist (upsert) the single SystemConfig row. */
