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
import { encryptToString } from "@/lib/crypto";
import { log } from "@/lib/obs/log";

/**
 * Best-effort persistence helper. Deletes are idempotent, so a P2025 ("row not
 * found") is expected and ignored; every other failure is logged. Previously
 * these paths used `.catch((err) => bestEffort(err))`, which silently diverged memory from DB.
 */
import { bestEffort, withFkRetry, todayUtcDate } from "./core";

export async function persistSubscription(sub: {
  userId: string;
  plan: string;
  status: string;
  periodStart: number;
  periodEnd: number;
  cancelAtPeriodEnd: boolean;
  paymentMethod?: string;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      plan: sub.plan,
      status: sub.status,
      periodStart: new Date(sub.periodStart),
      periodEnd: new Date(sub.periodEnd),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      paymentMethod: sub.paymentMethod ?? null,
    };
    await (db as unknown as { subscription: { upsert: (o: unknown) => Promise<unknown> } })
      .subscription.upsert({
        where: { userId: sub.userId },
        update: data,
        create: { userId: sub.userId, ...data },
      });
  } catch (err) {
    log.error({ err }, "[db] persistSubscription error");
  }
}

/** Persist an invoice to DB. */

export async function persistInvoice(invoice: {
  id: string;
  userId: string;
  amount: number;
  plan: string;
  status: string;
  method: string;
  date: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { invoice: { create: (o: unknown) => Promise<unknown> } })
      .invoice.create({
        data: {
          id: invoice.id,
          userId: invoice.userId,
          amount: invoice.amount,
          plan: invoice.plan,
          status: invoice.status,
          method: invoice.method,
          date: new Date(invoice.date),
        },
      }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] persistInvoice error");
  }
}

/** Persist an order to DB (upsert - checkout creates pending, payment flips it to paid). */

export async function persistOrder(order: {
  id: string;
  userId: string;
  plan: string;
  amount: number;
  method: string;
  status: string;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { order: { upsert: (o: unknown) => Promise<unknown> } })
      .order.upsert({
        where: { id: order.id },
        update: { status: order.status },
        create: {
          id: order.id,
          userId: order.userId,
          plan: order.plan,
          amount: order.amount,
          method: order.method,
          status: order.status,
          createdAt: new Date(order.createdAt),
        },
      });
  } catch (err) {
    log.error({ err }, "[db] persistOrder error");
  }
}

// ── Usage metering (workspace, daily) ────────────────────────────────────


export async function bumpWorkspaceUsage(
  workspaceId: string,
  kind: "qa" | "agent"
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const day = todayUtcDate();
    const d = db as unknown as {
      usageDaily: { upsert: (o: unknown) => Promise<unknown> };
    };
    await d.usageDaily.upsert({
      where: { workspaceId_day: { workspaceId, day } },
      // Prisma BigInt fields require bigint literals (a plain number throws).
      update: kind === "qa"
        ? { qaCount: { increment: BigInt(1) } }
        : { agentCount: { increment: BigInt(1) } },
      create: {
        workspaceId,
        day,
        qaCount: kind === "qa" ? BigInt(1) : BigInt(0),
        agentCount: kind === "agent" ? BigInt(1) : BigInt(0),
      },
    });
  } catch (err) {
    log.error({ err }, "[db] bumpWorkspaceUsage error");
  }
}

/** Atomically bump a user's daily QA/API or Agent counter. */

export async function bumpUserUsage(
  userId: string,
  kind: "qa" | "agent"
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const day = todayUtcDate();
    const d = db as unknown as {
      userUsageDaily: { upsert: (o: unknown) => Promise<unknown> };
    };
    await d.userUsageDaily.upsert({
      where: { userId_day: { userId, day } },
      update: kind === "qa"
        ? { qaCount: { increment: BigInt(1) }, apiCount: { increment: BigInt(1) } }
        : { agentCount: { increment: BigInt(1) } },
      create: {
        userId,
        day,
        qaCount: kind === "qa" ? BigInt(1) : BigInt(0),
        apiCount: kind === "qa" ? BigInt(1) : BigInt(0),
        agentCount: kind === "agent" ? BigInt(1) : BigInt(0),
      },
    });
  } catch (err) {
    log.error({ err }, "[db] bumpUserUsage error");
  }
}

/** Delete all billing rows for a user (account deletion). */

export async function deleteBillingDataFromDb(userId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const d = db as unknown as {
      subscription: { deleteMany: (o: unknown) => Promise<unknown> };
      invoice: { deleteMany: (o: unknown) => Promise<unknown> };
      order: { deleteMany: (o: unknown) => Promise<unknown> };
    };
    await Promise.all([
      d.subscription.deleteMany({ where: { userId } }).catch((err) => bestEffort(err)),
      d.invoice.deleteMany({ where: { userId } }).catch((err) => bestEffort(err)),
      d.order.deleteMany({ where: { userId } }).catch((err) => bestEffort(err)),
    ]);
  } catch (err) {
    log.error({ err }, "[db] deleteBillingDataFromDb error");
  }
}

// ── Security: Sessions + Login Events ────────────────────────────────────

/** Persist a login event to DB. */

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

export async function persistWorkspace(ws: {
  id: string;
  name: string;
  plan: string;
  ownerId: string;
  brandColor: string;
  /** D2: member emails - persisted so membership survives a restart. */
  members?: string[];
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      name: ws.name,
      plan: ws.plan,
      ownerId: ws.ownerId,
      brandColor: ws.brandColor,
      ...(ws.members ? { members: ws.members } : {}),
      updatedAt: new Date(),
    };
    await db.workspace.upsert({
      where: { id: ws.id },
      update: data,
      create: { id: ws.id, ...data, createdAt: new Date(ws.createdAt) },
    });
  } catch (err) {
    log.error({ err }, "[db] persistWorkspace error");
  }
}

/** Delete a workspace row (管理员删号 / 清理测试租户).
 *
 *  先清 KbChunk（向量表无 FK，会残留），再删工作区；KB/文档/会话/任务都通过
 *  workspaceId 级联或上游路由已删除，这里只兜底 workspace 本身。
 *  fire-and-forget：失败只记日志，内存态已经删掉。 */

export async function deleteWorkspaceFromDb(workspaceId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const raw = db as unknown as {
      $executeRawUnsafe?: (sql: string, ...params: unknown[]) => Promise<unknown>;
    };
    const exec = (sql: string, ...params: unknown[]) =>
      raw.$executeRawUnsafe?.(sql, ...params)?.catch((err: unknown) => bestEffort(err)) ?? Promise.resolve();
    // KbChunk 没有指向 Workspace 的 FK，删租户前先按 KB 清掉向量行
    await exec(
      'DELETE FROM kb_chunks WHERE kb_id IN (SELECT id FROM "KnowledgeBase" WHERE "workspaceId" = $1)',
      workspaceId
    );
    await exec('DELETE FROM "Workspace" WHERE id = $1', workspaceId);
  } catch (err) {
    log.error({ err }, "[db] deleteWorkspaceFromDb error");
  }
}

/** Append an audit log entry. */

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
