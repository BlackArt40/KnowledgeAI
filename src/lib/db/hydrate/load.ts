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

import { getDb, isDbEnabled } from "../prisma";
import { hydrateKb, hydrateDoc, hydrateTask } from "./identity";
import { decryptFromString } from "@/lib/crypto";
import { hydrateSecurityState } from "@/lib/security/store";
import { markNotificationsHydrated } from "@/lib/notifications/store";
import { hydrateUserUsage, hydrateWorkspaceUsage } from "@/lib/billing/store";
import type { UsagePoint } from "@/lib/billing/types";
import type { SecurityState } from "@/lib/security/types";
import type { PrismaUser, PrismaUserSecurity, PrismaKb, PrismaDoc, PrismaAgentTask } from "../types";
import { mergeApiKeyRow, type ApiKeyRow } from "@/lib/apikeys/store";
import { hydrateInviteReservation } from "@/lib/team/invite-seats";
import { log } from "@/lib/obs/log";
import {
  createEmptyAdminStore,
  createEmptyAgentStore,
  createEmptyApiKeyStore,
  createEmptyAuthStore,
  createEmptyBillingStore,
  createEmptyChatStore,
  createEmptyKbStore,
  createEmptyKgStore,
  createEmptyModelStore,
  createEmptyNotificationStore,
  createEmptySecurityStore,
  createEmptyTeamStore,
  createEmptyWebhookStore,
  createEmptyWorkspaceStore,
} from "../store-factories";

// P1-9: coalesce concurrent first-request calls (the proxy fires
// ensureHydrated() fire-and-forget on every request) into a single in-flight
// hydration promise - the old code ran hydrateFromDb() N times in parallel,
// duplicating rows in the in-memory stores. Reset on settle so a FAILED
// hydration (see P1-10) retries on the next request.

/** Whether hydration has been completed. */
export async function loadKbFromDb(kbId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const row = await db.knowledgeBase.findUnique({ where: { id: kbId } });
    if (!row) return false;
    hydrateKb(row);
    return true;
  } catch (err) {
    log.warn({ err }, "[db] loadKbFromDb failed");
    return false;
  }
}


export async function loadDocFromDb(docId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const row = await db.kbDocument.findUnique({ where: { id: docId } });
    if (!row) return false;
    hydrateDoc(row);
    // The processing pipeline resolves the owning KB from the store too.
    const kbRow = await db.knowledgeBase.findUnique({ where: { id: row.kbId } });
    if (kbRow) hydrateKb(kbRow);
    return true;
  } catch (err) {
    log.warn({ err }, "[db] loadDocFromDb failed");
    return false;
  }
}


export async function loadTaskFromDb(taskId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const row = await db.agentTask.findUnique({ where: { id: taskId } });
    if (!row) return false;
    hydrateTask(row);
    // runTask resolves the KB from the store for RAG retrieval.
    if (row.kbId) {
      const kbRow = await db.knowledgeBase.findUnique({ where: { id: row.kbId } });
      if (kbRow) hydrateKb(kbRow);
    }
    return true;
  } catch (err) {
    log.warn({ err }, "[db] loadTaskFromDb failed");
    return false;
  }
}


export async function loadOrderFromDb(orderId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const row = await db.order.findUnique({ where: { id: orderId } });
    if (!row) return false;
    const g = globalThis as unknown as {
      __KAI_BILLING_STORE__?: { orders: Map<string, unknown> };
    };
    if (!g.__KAI_BILLING_STORE__) return false;
    g.__KAI_BILLING_STORE__.orders.set(row.id, {
      id: row.id,
      userId: row.userId,
      plan: row.plan,
      amount: row.amount,
      method: row.method,
      status: row.status,
      createdAt: row.createdAt.getTime(),
    });
    return true;
  } catch (err) {
    log.warn({ err }, "[db] loadOrderFromDb failed");
    return false;
  }
}


export async function loadWebhookFromDb(subscriptionId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const row = await (db as unknown as {
      webhookSubscription: { findUnique: (o: unknown) => Promise<Record<string, unknown> | null> };
    }).webhookSubscription.findUnique({ where: { id: subscriptionId } });
    if (!row) return false;
    const g = globalThis as unknown as { __KAI_WEBHOOK_STORE__?: { subs: Map<string, unknown> } };
    if (!g.__KAI_WEBHOOK_STORE__) return false;
    g.__KAI_WEBHOOK_STORE__.subs.set(subscriptionId, {
      id: row.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      name: row.name,
      url: row.url,
      secret: row.secret,
      events: row.events,
      active: row.active,
      createdAt: (row.createdAt as Date).getTime(),
      lastDeliveryAt: row.lastDeliveryAt ? (row.lastDeliveryAt as Date).getTime() : null,
      failures: row.failures,
      lastError: row.lastError,
    });
    return true;
  } catch (err) {
    log.warn({ err }, "[db] loadWebhookFromDb failed");
    return false;
  }
}

// ── Pending invite seat reservations (2026-11) ────────────────────────────
// Invitations are stateless tokens; the seat budget is durable so a restart
// cannot resurrect capacity that is already spoken for.
