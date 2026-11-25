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


import { getDb, isDbEnabled } from "../prisma";

import { log } from "@/lib/obs/log";

/**
 * Best-effort persistence helper. Deletes are idempotent, so a P2025 ("row not
 * found") is expected and ignored; every other failure is logged. Previously
 * these paths used `.catch((err) => bestEffort(err))`, which silently diverged memory from DB.
 */
import { bestEffort, todayUtcDate } from "./core";

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

