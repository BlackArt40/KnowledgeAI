// Hydration entrypoint/state machine; domain loaders live in ./hydrate/*.
import { getDb, isDbEnabled } from "./prisma";
import { log } from "@/lib/obs/log";
import {
  createEmptyAdminStore, createEmptyAgentStore, createEmptyApiKeyStore,
  createEmptyAuthStore, createEmptyBillingStore, createEmptyChatStore,
  createEmptyKbStore, createEmptyKgStore, createEmptyModelStore,
  createEmptyNotificationStore, createEmptySecurityStore, createEmptyTeamStore,
  createEmptyWebhookStore, createEmptyWorkspaceStore,
} from "./store-factories";
let _hydrated = false;
let _hydrating: Promise<void> | null = null;

import {
  hydrateSecurityStates, hydrateUser, hydrateKb, hydrateDoc, hydrateTask,
} from "./hydrate/identity";
import {
  hydrateConversations, hydrateModelConfigs, hydrateAudit,
  hydrateNotifications, hydrateUsage,
} from "./hydrate/feeds";
import {
  hydrateTeam, hydrateWorkspace, hydrateWebhookSubscriptions, hydrateSystemConfig,
  hydrateBotIntegrations, hydrateKnowledgeGraph, hydrateApiKeys, hydrateBilling,
  hydrateInviteReservations,
} from "./hydrate/admin";

export * from "./hydrate/load";

export function isHydrated(): boolean {
  return _hydrated;
}

/**
 * Load all data from the database into in-memory stores.
 * Called once on server startup (lazy, on first API request).
 * Safe to call multiple times - only runs once.
 */

export async function hydrateFromDb(): Promise<void> {
  if (_hydrated || !isDbEnabled()) return;

  const db = await getDb();
  if (!db) return;

  // Stores are created lazily by their modules on first access, but hydration
  // is triggered from the proxy on the first request and races with route
  // handlers. A store that has not been touched yet would make its hydrateX()
  // no-op (data loaded from DB would never appear in the app). Ensure every
  // store exists first (P4-3 regression: KBs/tasks/conversations/team/... were
  // silently missing after restart in DB mode).
  ensureStores();

  log.info("[db] Hydrating in-memory stores from PostgreSQL...");
  const counts = { users: 0, kbs: 0, docs: 0, tasks: 0 };

  try {
    // ── Users ──────────────────────────────────────────────
    const users = await db.user.findMany({});
    for (const u of users) {
      hydrateUser(u);
    }
    counts.users = users.length;

    // ── Knowledge Bases ────────────────────────────────────
    const kbs = await db.knowledgeBase.findMany({ orderBy: { updatedAt: "desc" } });
    for (const kb of kbs) {
      hydrateKb(kb);
    }
    counts.kbs = kbs.length;

    // ── Documents ──────────────────────────────────────────
    const docs = await db.kbDocument.findMany({ orderBy: { uploadedAt: "desc" } });
    for (const d of docs) {
      hydrateDoc(d);
    }
    counts.docs = docs.length;

    // ── Agent Tasks ────────────────────────────────────────
    const tasks = await db.agentTask.findMany({ orderBy: { createdAt: "desc" } });
    for (const t of tasks) {
      hydrateTask(t);
    }
    counts.tasks = tasks.length;

    // ── Extended models (P0-1 expansion) ──────────────────────────────
    // P0: 2FA secrets / sessions / login history must survive restarts.
    const security = await hydrateSecurityStates();
    const convs = await hydrateConversations();
    const models = await hydrateModelConfigs();
    const notifs = await hydrateNotifications();
    const team = await hydrateTeam();
    const admin = await hydrateSystemConfig();
    const audit = await hydrateAudit();
    const keys = await hydrateApiKeys();
    const billing = await hydrateBilling();
    // P1: workspace QA/Agent counters (quota + usage.alert source).
    const usage = await hydrateUsage();
    // P5-5: workspace rows (brand color survives restarts).
    const workspaces = await hydrateWorkspace();
    // P7-1: webhook subscription rows (delivery state survives restarts).
    const webhooks = await hydrateWebhookSubscriptions();
    // P7-2: bot integration rows (bindings survive restarts).
    const bots = await hydrateBotIntegrations();
    // P7-3: knowledge-graph rows (entities/relations survive restarts).
    const graph = await hydrateKnowledgeGraph();
    // 2026-11: pending invite seat reservations (seat budget survives restarts).
    const invites = await hydrateInviteReservations();

    _hydrated = true;
    // With DB rows loaded, block the demo seed() paths (seed only runs while
    // seeded === false) so demo rows cannot mix with DB rows.
    markSeeded();
    // B3: 种子文档以 queued 落库（没有向量），重启后没人继续处理会永远卡住；
    // 这里统一重投（队列按 docId 去重，与在跑的 worker 不冲突）。
    const { resumePendingDocs } = await import("@/lib/kb/store");
    const resumed = resumePendingDocs();
    log.info(
      `[db] Hydration complete: ${counts.users} users, ${counts.kbs} KBs, ${counts.docs} docs, ${counts.tasks} tasks, ${security} security, ${convs} convs, ${models} models, ${notifs} notifs, team={${team.team}t/${team.members}m/${team.audit}a}, admin=${admin}, audit=${audit}, workspaces=${workspaces}, webhooks=${webhooks}, bots=${bots}, graph=${graph}, invites=${invites}, keys=${keys}, billing=${billing}, usage=${usage}, resumedDocs=${resumed}`
    );
  } catch (err) {
    log.error({ err }, "[db] Hydration failed");
    // Don't set _hydrated = true so it retries on next request
  }
}

// ── Per-model hydration helpers ──────────────────────────────────────────

/**
 * Create every in-memory store before hydration writes into it. Store
 * modules initialize their globalThis singleton lazily on first access;
 * hydration runs concurrently with the first request, so stores the request
 * path has not touched yet would otherwise make their hydrateX() a no-op and
 * the DB rows would never surface. The structures mirror the init code in
 * each store module (kb/chat/agent/workspace/team/notifications/webhooks/
 * admin/bots/kg) so later store() calls reuse them unchanged.
 */

function ensureStores(): void {
  const g = globalThis as Record<string, unknown>;
  if (!g.__KAI_USER_STORE__) g.__KAI_USER_STORE__ = createEmptyAuthStore();
  if (!g.__KAI_SECURITY_STORE__) g.__KAI_SECURITY_STORE__ = createEmptySecurityStore();
  if (!g.__KAI_KB_STORE__) g.__KAI_KB_STORE__ = createEmptyKbStore();
  if (!g.__KAI_CHAT_STORE__) g.__KAI_CHAT_STORE__ = createEmptyChatStore();
  if (!g.__KAI_AGENT_STORE__) g.__KAI_AGENT_STORE__ = createEmptyAgentStore();
  if (!g.__KAI_MODEL_STORE__) g.__KAI_MODEL_STORE__ = createEmptyModelStore();
  if (!g.__KAI_NOTIF_STORE__ || !(g.__KAI_NOTIF_STORE__ as { seededUsers?: unknown }).seededUsers)
    g.__KAI_NOTIF_STORE__ = createEmptyNotificationStore();
  if (!g.__KAI_TEAM_STORE__) g.__KAI_TEAM_STORE__ = createEmptyTeamStore();
  if (!g.__KAI_WORKSPACE_STORE__) g.__KAI_WORKSPACE_STORE__ = createEmptyWorkspaceStore();
  if (!g.__KAI_INVITE_SEATS__) g.__KAI_INVITE_SEATS__ = new Map();
  if (!g.__KAI_WEBHOOK_STORE__) g.__KAI_WEBHOOK_STORE__ = createEmptyWebhookStore();
  if (!g.__KAI_BOT_STORE__)
    g.__KAI_BOT_STORE__ = { bots: new Map(), plaintextTokens: new Map() };
  if (!g.__KAI_GRAPH_STORE__) g.__KAI_GRAPH_STORE__ = createEmptyKgStore();
  if (!g.__KAI_ADMIN_STORE__) g.__KAI_ADMIN_STORE__ = createEmptyAdminStore();
  if (!g.__KAI_APIKEY_STORE__) g.__KAI_APIKEY_STORE__ = createEmptyApiKeyStore();
  if (!g.__KAI_BILLING_STORE__)
    // seeded: true - DB rows are authoritative once hydration runs; the
    // demo subscription/invoice seed must not mix into a DB-backed store.
    g.__KAI_BILLING_STORE__ = createEmptyBillingStore(true);
}

/** Block demo seed() paths now that DB rows are authoritative. */

function markSeeded(): void {
  const g = globalThis as Record<string, unknown>;
  const userStore = g.__KAI_USER_STORE__ as { seeded?: boolean } | undefined;
  if (userStore) userStore.seeded = true;
  const kbStore = g.__KAI_KB_STORE__ as { seeded?: boolean } | undefined;
  if (kbStore) kbStore.seeded = true;
  const teamStore = g.__KAI_TEAM_STORE__ as { seeded?: boolean } | undefined;
  if (teamStore) teamStore.seeded = true;
}


export async function ensureHydrated(): Promise<void> {
  if (!isDbEnabled() || _hydrated) return;
  if (!_hydrating) {
    _hydrating = hydrateFromDb().finally(() => {
      _hydrating = null;
    });
  }
  await _hydrating;
}

// ── Extended hydration for additional models ─────────────────────────────

/** Hydrate conversations + messages from DB. */
