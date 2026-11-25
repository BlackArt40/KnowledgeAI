// ---------------------------------------------------------------------------
// Hydration - loads data from PostgreSQL into in-memory stores on startup.
//
// This enables a "write-through cache" pattern:
//   - On boot: hydrate memory stores from DB (data survives restarts)
//   - On write: persist mutations to DB (see persist.ts)
//   - On read: always use fast in-memory stores (no async needed)
//
// When DB is not configured, hydration is a no-op (stores use seed data).
// ---------------------------------------------------------------------------

import { getDb } from "../prisma";







import { hydrateInviteReservation } from "@/lib/team/invite-seats";
import { log } from "@/lib/obs/log";


// P1-9: coalesce concurrent first-request calls (the proxy fires
// ensureHydrated() fire-and-forget on every request) into a single in-flight
// hydration promise - the old code ran hydrateFromDb() N times in parallel,
// duplicating rows in the in-memory stores. Reset on settle so a FAILED
// hydration (see P1-10) retries on the next request.

/** Whether hydration has been completed. */
export async function hydrateBilling(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const g = globalThis as unknown as {
    __KAI_BILLING_STORE__?: {
      subscriptionsByUser: Map<string, unknown>;
      invoicesByUser: Map<string, unknown[]>;
      orders: Map<string, unknown>;
    };
  };
  if (!g.__KAI_BILLING_STORE__) return 0;
  try {
    const sdb = db as unknown as {
      subscription: { findMany: (o?: unknown) => Promise<unknown[]> };
      invoice: { findMany: (o?: unknown) => Promise<unknown[]> };
      order: { findMany: (o?: unknown) => Promise<unknown[]> };
    };
    const store = g.__KAI_BILLING_STORE__;
    const subs = await sdb.subscription.findMany({});
    for (const s of subs as unknown as {
      userId: string; plan: string; status: string;
      periodStart: Date; periodEnd: Date; paymentMethod: string | null;
    }[]) {
      store.subscriptionsByUser.set(s.userId, {
        plan: s.plan,
        status: s.status,
        periodStart: s.periodStart.getTime(),
        periodEnd: s.periodEnd.getTime(),
        seats: 1,
        paymentMethod: s.paymentMethod ?? undefined,
      });
    }
    const invoices = await sdb.invoice.findMany({ orderBy: { date: "desc" } });
    for (const inv of invoices as unknown as {
      id: string; userId: string; amount: number; plan: string; status: string; method: string; date: Date;
    }[]) {
      const list = store.invoicesByUser.get(inv.userId) ?? [];
      list.push({
        id: inv.id,
        date: inv.date.getTime(),
        amount: inv.amount,
        plan: inv.plan,
        status: inv.status,
        method: inv.method,
      });
      store.invoicesByUser.set(inv.userId, list);
    }
    const orders = await sdb.order.findMany({ orderBy: { createdAt: "desc" } });
    for (const o of orders as unknown as {
      id: string; userId: string; plan: string; amount: number; method: string; status: string; createdAt: Date;
    }[]) {
      store.orders.set(o.id, {
        id: o.id,
        userId: o.userId,
        plan: o.plan,
        amount: o.amount,
        method: o.method,
        status: o.status,
        createdAt: o.createdAt.getTime(),
      });
    }
    return subs.length + invoices.length + orders.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateBilling error");
    throw err;
  }
}

// ── On-demand single-row hydration (cross-process consistency) ──────────
//
// The worker process hydrates its in-memory stores once at boot. Rows
// created afterwards by the web process (uploads, agent runs, webhook
// subscriptions) reach the DB via fire-and-forget persist - a separate
// worker would report "Document/Task/Subscription not found" for anything
// created after boot. Queue handlers call these before handling; BullMQ
// retries (attempts: 3) cover the persist race window.



export async function hydrateInviteReservations(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const table = db as unknown as {
      teamInviteReservation: {
        findMany: (o: unknown) => Promise<
          Array<{ workspaceId: string; email: string; role: string; expiresAt: Date }>
        >;
      };
    };
    const rows = await table.teamInviteReservation.findMany({
      where: { expiresAt: { gt: new Date() } },
    });
    for (const row of rows) {
      hydrateInviteReservation({
        workspaceId: row.workspaceId,
        email: row.email,
        role: row.role.toLowerCase(),
        expiresAt: row.expiresAt.getTime(),
      });
    }
    return rows.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateInviteReservations error");
    return 0;
  }
}
