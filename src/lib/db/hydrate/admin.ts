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
import { decryptFromString } from "@/lib/crypto";
import { hydrateSecurityState } from "@/lib/security/store";
import { markNotificationsHydrated } from "@/lib/notifications/store";
import { hydrateUserUsage, hydrateWorkspaceUsage } from "@/lib/billing/store";
import type { UsagePoint } from "@kai/shared/billing/types";
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
export async function hydrateTeam(): Promise<{ team: number; members: number; audit: number }> {
  const db = await getDb();
  if (!db) return { team: 0, members: 0, audit: 0 };
  const g = globalThis as unknown as {
    __KAI_TEAM_STORE__?: {
      team: { id: string; name: string; logoInitial: string; plan: string; createdAt: number };
      members: Map<string, unknown>;
      audit: unknown[];
      kbAccess: Map<string, string>;
      kbMemberRoles: Map<string, Record<string, string>>;
      seeded: boolean;
    };
  };
  if (!g.__KAI_TEAM_STORE__) return { team: 0, members: 0, audit: 0 };
  const store = g.__KAI_TEAM_STORE__;
  try {
    const t = db as unknown as {
      team: { findUnique: (o: unknown) => Promise<Record<string, unknown> | null> };
    };
    const teamRow = await t.team.findUnique({ where: { id: "team_default" } });
    if (teamRow) {
      store.team = {
        id: teamRow.id as string,
        name: teamRow.name as string,
        logoInitial: (teamRow.logoInitial as string) ?? "K",
        plan: (teamRow.plan as string) ?? "专业版",
        createdAt: (teamRow.createdAt as Date).getTime(),
      };
      const ka = teamRow.kbAccess as Record<string, string> | null;
      if (ka && typeof ka === "object") {
        for (const [k, v] of Object.entries(ka)) store.kbAccess.set(k, v);
      }
      // M-7: restore per-KB member role overrides (kbId -> email -> role) -
      // they used to be memory-only and vanished on restart (P4-2 drift).
      const kmr = teamRow.kbMemberRoles as Record<string, Record<string, string>> | null;
      if (kmr && typeof kmr === "object") {
        for (const [kbId, roles] of Object.entries(kmr)) {
          if (roles && typeof roles === "object") store.kbMemberRoles.set(kbId, roles);
        }
      }
    }

    const tm = db as unknown as {
      teamMember: { findMany: (o?: unknown) => Promise<Record<string, unknown>[]> };
    };
    const members = await tm.teamMember.findMany({
      where: { teamId: "team_default" },
      orderBy: { joinedAt: "desc" },
    });
    store.members.clear();
    for (const m of members) {
      const user = await db.user.findUnique({ where: { id: m.userId as string } });
      if (!user) continue;
      store.members.set(m.id as string, {
        id: m.id,
        name: user.name,
        email: user.email,
        role: String(m.role ?? "EDITOR").toLowerCase(),
        status: user.status === "BANNED" ? "suspended" : "active",
        lastActiveAt: user.lastLoginAt ? user.lastLoginAt.getTime() : user.createdAt.getTime(),
        joinedAt: (m.joinedAt as Date).getTime(),
      });
    }

    const al = db as unknown as {
      auditLog: { findMany: (o?: unknown) => Promise<Record<string, unknown>[]> };
    };
    const audit = await al.auditLog.findMany({
      where: { teamId: "team_default" },
      orderBy: { createdAt: "desc" },
    });
    store.audit = audit.map((a) => ({
      id: a.id,
      actor: (a.actor as string) ?? "",
      action: a.action as string,
      target: (a.target as string) ?? "",
      detail: a.detail as string,
      createdAt: (a.createdAt as Date).getTime(),
    }));

    return { team: teamRow ? 1 : 0, members: members.length, audit: audit.length };
  } catch (err) {
    log.error({ err }, "[db] hydrateTeam error");
    return { team: 0, members: 0, audit: 0 };
  }
}

// ── Workspace hydration (P5-5) ────────────────────────────────────────────

/**
 * Merge DB workspace rows into __KAI_WORKSPACE_STORE__. `members` stay
 * memory-only (the Workspace table has no member relation yet), so seeded
 * workspaces keep their member lists while name/plan/ownerId/brandColor
 * survive restarts. DB-only rows (created in a previous process) are added
 * with an empty member list.
 */

export async function hydrateWorkspace(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const g = globalThis as unknown as { __KAI_WORKSPACE_STORE__?: Map<string, unknown> };
  if (!g.__KAI_WORKSPACE_STORE__) return 0;
  const store = g.__KAI_WORKSPACE_STORE__;
  try {
    const rows = await db.workspace.findMany({});
    for (const w of rows) {
      const existing = store.get(w.id) as
        | { members?: string[]; createdAt?: number }
        | undefined;
      const dbMembers = (w as unknown as { members?: string[] }).members ?? [];
      store.set(w.id, {
        id: w.id,
        name: w.name,
        plan: w.plan,
        ownerId: w.ownerId,
        brandColor: w.brandColor ?? "indigo",
        // D2: prefer the persisted member list. Legacy rows created before the
        // column existed come back as [] - keep the in-memory seed for
        // ws_default in that case so existing installs don't lose their demo
        // membership (and their tenant resolution) after an upgrade.
        members: dbMembers.length > 0 ? dbMembers : existing?.members ?? [],
        createdAt: existing?.createdAt ?? w.createdAt.getTime(),
      });
    }
    return rows.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateWorkspace error");
    throw err;
  }
}

// ── P7-1: Webhook subscription hydration ──────────────────────────────────

/**
 * Merge DB webhook subscription rows into __KAI_WEBHOOK_STORE__ so configured
 * endpoints + delivery state survive restarts. Subscriptions created in a
 * previous process land in the store; memory-only delivery records stay lost
 * (they are a short ring buffer by design).
 */

export async function hydrateWebhookSubscriptions(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const g = globalThis as unknown as {
    __KAI_WEBHOOK_STORE__?: { subs: Map<string, unknown>; deliveries: unknown[] };
  };
  if (!g.__KAI_WEBHOOK_STORE__) return 0;
  try {
    const rows = await (db as unknown as {
      webhookSubscription: { findMany: (o?: unknown) => Promise<unknown[]> };
    }).webhookSubscription.findMany({});
    const store = g.__KAI_WEBHOOK_STORE__.subs;
    for (const r of rows as unknown as {
      id: string; userId: string; workspaceId: string; name: string; url: string;
      secret: string; events: string[]; active: boolean; createdAt: Date;
      lastDeliveryAt: Date | null; failures: number; lastError: string | null;
    }[]) {
      const existing = store.get(r.id) as
        | { lastDeliveryAt?: number | null; failures?: number; lastError?: string | null }
        | undefined;
      store.set(r.id, {
        id: r.id,
        userId: r.userId,
        workspaceId: r.workspaceId,
        name: r.name,
        url: r.url,
        secret: r.secret,
        events: r.events,
        active: r.active,
        createdAt: r.createdAt.getTime(),
        lastDeliveryAt: existing?.lastDeliveryAt ?? (r.lastDeliveryAt ? r.lastDeliveryAt.getTime() : null),
        failures: existing?.failures ?? r.failures,
        lastError: existing?.lastError ?? r.lastError,
      });
    }
    return rows.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateWebhookSubscriptions error");
    throw err;
  }
}

// ── Admin SystemConfig hydration ─────────────────────────────────────────


export async function hydrateSystemConfig(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const g = globalThis as unknown as { __KAI_ADMIN_STORE__?: { config: Record<string, unknown> } };
  if (!g.__KAI_ADMIN_STORE__) return false;
  try {
    const sc = db as unknown as {
      systemConfig: { findUnique: (o: unknown) => Promise<Record<string, unknown> | null> };
    };
    const row = await sc.systemConfig.findUnique({ where: { id: 1 } });
    if (!row) return false;
    g.__KAI_ADMIN_STORE__.config = {
      defaultModel: row.defaultModel,
      embeddingModel: row.embeddingModel,
      rateLimitPerMin: row.rateLimitPerMin,
      maxUploadMb: row.maxUploadMb,
      maintenanceMode: row.maintenanceMode,
      allowSignup: row.allowSignup,
      required2FARoles: (row.required2FARoles as string[]) ?? [],
    };
    return true;
  } catch (err) {
    log.error({ err }, "[db] hydrateSystemConfig error");
    // P1-10: propagate - a transient failure must retry on the next request.
    throw err;
  }
}

// ── P7-2: Bot integration hydration ───────────────────────────────────────

/**
 * Merge DB bot rows into __KAI_BOT_STORE__ so bindings survive restarts.
 * The plaintext token is intentionally not stored anywhere - only the hash,
 * so hydrated bindings can verify callbacks but cannot re-reveal the token.
 */

export async function hydrateBotIntegrations(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const g = globalThis as unknown as { __KAI_BOT_STORE__?: { bots: Map<string, unknown>; plaintextTokens: Map<string, string> } };
  if (!g.__KAI_BOT_STORE__) return 0;
  try {
    const rows = await (db as unknown as {
      botIntegration: { findMany: (o?: unknown) => Promise<unknown[]> };
    }).botIntegration.findMany({});
    const store = g.__KAI_BOT_STORE__.bots;
    for (const r of rows as unknown as {
      id: string; userId: string; workspaceId: string; name: string; platform: string;
      kbId: string; kbName: string; tokenHash: string; active: boolean; calls: number;
      createdAt: Date;
    }[]) {
      const existing = store.get(r.id) as { calls?: number } | undefined;
      store.set(r.id, {
        id: r.id,
        userId: r.userId,
        workspaceId: r.workspaceId,
        name: r.name,
        platform: r.platform,
        kbId: r.kbId,
        kbName: r.kbName,
        tokenHash: r.tokenHash,
        active: r.active,
        calls: existing?.calls ?? r.calls,
        createdAt: r.createdAt.getTime(),
      });
    }
    return rows.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateBotIntegrations error");
    throw err;
  }
}

// ── P7-3: Knowledge-graph hydration ───────────────────────────────────────

/**
 * Merge DB graph rows into __KAI_GRAPH_STORE__ so extracted entities and
 * relations survive restarts. Per-doc contribution maps are memory-only
 * (rebuilt on the next re-index), so hydrate only fills entities/relations
 * and the label index.
 */

export async function hydrateKnowledgeGraph(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const g = globalThis as unknown as {
    __KAI_GRAPH_STORE__?: {
      entities: Map<string, unknown>;
      relations: Map<string, unknown>;
      labelIndex: Map<string, string>;
      docGraphs: Map<string, unknown>;
    };
  };
  if (!g.__KAI_GRAPH_STORE__) return 0;
  try {
    const ke = db as unknown as {
      knowledgeEntity: { findMany: (o?: unknown) => Promise<unknown[]> };
      knowledgeRelation: { findMany: (o?: unknown) => Promise<unknown[]> };
    };
    const entityRows = await ke.knowledgeEntity.findMany({});
    const relationRows = await ke.knowledgeRelation.findMany({});
    for (const r of entityRows as unknown as {
      id: string; kbId: string; label: string; type: string; mentions: number;
      docIds: string[]; createdAt: Date;
    }[]) {
      const existing = g.__KAI_GRAPH_STORE__.entities.get(r.id) as
        | { mentions?: number; docIds?: string[] } | undefined;
      g.__KAI_GRAPH_STORE__.entities.set(r.id, {
        id: r.id,
        kbId: r.kbId,
        label: r.label,
        type: r.type,
        mentions: existing?.mentions ?? r.mentions,
        docIds: existing?.docIds ?? r.docIds,
        createdAt: r.createdAt.getTime(),
      });
      g.__KAI_GRAPH_STORE__.labelIndex.set(`${r.kbId}:${r.label}`, r.id);
    }
    for (const r of relationRows as unknown as {
      id: string; kbId: string; source: string; target: string; type: string;
      weight: number; docIds: string[]; createdAt: Date;
    }[]) {
      const existing = g.__KAI_GRAPH_STORE__.relations.get(r.id) as
        | { weight?: number; docIds?: string[] } | undefined;
      g.__KAI_GRAPH_STORE__.relations.set(r.id, {
        id: r.id,
        kbId: r.kbId,
        source: r.source,
        target: r.target,
        type: r.type,
        weight: existing?.weight ?? r.weight,
        docIds: existing?.docIds ?? r.docIds,
        createdAt: r.createdAt.getTime(),
      });
    }
    return entityRows.length + relationRows.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateKnowledgeGraph error");
    throw err;
  }
}

/** Hydrate API keys from DB (secrets stay encrypted at rest - decrypt here). */

export async function hydrateApiKeys(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const g = globalThis as unknown as { __KAI_APIKEY_STORE__?: { keys: Array<Record<string, unknown>> } };
  if (!g.__KAI_APIKEY_STORE__) return 0;
  try {
    const rows = await (db as unknown as {
      apiKey: { findMany: (o?: unknown) => Promise<unknown[]> };
    }).apiKey.findMany({ orderBy: { createdAt: "desc" } });
    for (const r of rows as unknown as ApiKeyRow[]) mergeApiKeyRow(r);
    return g.__KAI_APIKEY_STORE__.keys.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateApiKeys error");
    throw err;
  }
}

/** Hydrate subscriptions / invoices / orders so billing pages show history
 *  after restart. (Workspace usage is hydrated by hydrateUsage below.) */

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
