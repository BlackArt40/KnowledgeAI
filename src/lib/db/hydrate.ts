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

import { getDb, isDbEnabled } from "./client";
import { decryptFromString, isEncrypted } from "@/lib/crypto";
import type { PrismaUser, PrismaKb, PrismaDoc, PrismaAgentTask } from "./types";
import { log } from "@/lib/obs/log";

let _hydrated = false;

/** Whether hydration has been completed. */
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
    const convs = await hydrateConversations();
    const models = await hydrateModelConfigs();
    const notifs = await hydrateNotifications();
    const team = await hydrateTeam();
    const admin = await hydrateSystemConfig();
    const audit = await hydrateAudit();
    const keys = await hydrateApiKeys();
    const billing = await hydrateBilling();
    // P5-5: workspace rows (brand color survives restarts).
    const workspaces = await hydrateWorkspace();
    // P7-1: webhook subscription rows (delivery state survives restarts).
    const webhooks = await hydrateWebhookSubscriptions();
    // P7-2: bot integration rows (bindings survive restarts).
    const bots = await hydrateBotIntegrations();
    // P7-3: knowledge-graph rows (entities/relations survive restarts).
    const graph = await hydrateKnowledgeGraph();

    _hydrated = true;
    // With DB rows loaded, block the demo seed() paths (seed only runs while
    // seeded === false) so demo rows cannot mix with DB rows.
    markSeeded();
    log.info(
      `[db] Hydration complete: ${counts.users} users, ${counts.kbs} KBs, ${counts.docs} docs, ${counts.tasks} tasks, ${convs} convs, ${models} models, ${notifs} notifs, team={${team.team}t/${team.members}m/${team.audit}a}, admin=${admin}, audit=${audit}, workspaces=${workspaces}, webhooks=${webhooks}, bots=${bots}, graph=${graph}, keys=${keys}, billing=${billing}`
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
  if (!g.__KAI_USER_STORE__)
    g.__KAI_USER_STORE__ = { users: new Map(), emailIndex: new Map(), seeded: false };
  if (!g.__KAI_KB_STORE__)
    g.__KAI_KB_STORE__ = { kbs: new Map(), docs: new Map(), seeded: false };
  if (!g.__KAI_CHAT_STORE__)
    g.__KAI_CHAT_STORE__ = { conversations: new Map() };
  if (!g.__KAI_AGENT_STORE__)
    g.__KAI_AGENT_STORE__ = { tasks: new Map() };
  if (!g.__KAI_MODEL_STORE__)
    g.__KAI_MODEL_STORE__ = new Map();
  if (!g.__KAI_NOTIF_STORE__ || !(g.__KAI_NOTIF_STORE__ as { seededUsers?: unknown }).seededUsers)
    g.__KAI_NOTIF_STORE__ = { prefsByUser: new Map(), notificationsByUser: new Map(), seededUsers: new Set() };
  if (!g.__KAI_TEAM_STORE__)
    g.__KAI_TEAM_STORE__ = {
      team: { id: "team_default", name: "KnowledgeAI 团队", logoInitial: "K", plan: "专业版", createdAt: Date.now() - 1000 * 60 * 60 * 24 * 90 },
      members: new Map(),
      audit: [],
      kbAccess: new Map(),
      kbMemberRoles: new Map(),
      seeded: false,
    };
  if (!g.__KAI_WORKSPACE_STORE__)
    g.__KAI_WORKSPACE_STORE__ = new Map();
  if (!g.__KAI_WEBHOOK_STORE__)
    g.__KAI_WEBHOOK_STORE__ = { subs: new Map(), deliveries: [] };
  if (!g.__KAI_BOT_STORE__)
    g.__KAI_BOT_STORE__ = { bots: new Map(), plaintextTokens: new Map() };
  if (!g.__KAI_GRAPH_STORE__)
    g.__KAI_GRAPH_STORE__ = { entities: new Map(), relations: new Map(), labelIndex: new Map(), docGraphs: new Map() };
  if (!g.__KAI_ADMIN_STORE__)
    // Mirror admin/store.ts defaults - an empty config would make
    // getConfig() throw (e.g. required2FARoles) and 2FA policy fails closed.
    g.__KAI_ADMIN_STORE__ = {
      config: {
        defaultModel: "gpt-4o",
        embeddingModel: "bge-m3",
        rateLimitPerMin: 60,
        maxUploadMb: 50,
        maintenanceMode: false,
        allowSignup: true,
        required2FARoles: [],
      },
    };
  if (!g.__KAI_APIKEY_STORE__)
    g.__KAI_APIKEY_STORE__ = { keys: [], logs: [] };
  if (!g.__KAI_BILLING_STORE__)
    // seeded: true - DB rows are authoritative once hydration runs; the
    // demo subscription/invoice seed must not mix into a DB-backed store.
    g.__KAI_BILLING_STORE__ = {
      subscriptionsByUser: new Map(),
      invoicesByUser: new Map(),
      orders: new Map(),
      usageByUser: new Map(),
      seeded: true,
    };

  // The default workspace is the tenant fallback for every request (cookie /
  // no-cookie resolution); it must exist even when the DB has no row for it.
  const wsStore = g.__KAI_WORKSPACE_STORE__ as Map<string, {
    id: string; name: string; plan: string; ownerId: string;
    members: string[]; createdAt: number; brandColor: string;
  }>;
  if (!wsStore.has("ws_default")) {
    wsStore.set("ws_default", {
      id: "ws_default",
      name: "KnowledgeAI 团队",
      plan: "pro",
      ownerId: "usr_owner",
      members: ["owner@knowledgeai.dev", "admin@knowledgeai.dev", "editor@knowledgeai.dev", "viewer@knowledgeai.dev"],
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 90,
      brandColor: "indigo",
    });
  }
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

function hydrateUser(u: PrismaUser): void {
  const g = globalThis as unknown as { __KAI_USER_STORE__?: { users: Map<string, unknown>; emailIndex: Map<string, string>; seeded: boolean } };
  if (!g.__KAI_USER_STORE__) return;
  const store = g.__KAI_USER_STORE__;
  const user = {
    id: u.id,
    email: u.email,
    name: u.name,
    passwordHash: u.passwordHash || "",
    role: u.role.toLowerCase(),
    plan: "free" as const,
    status: u.status.toLowerCase(),
    createdAt: u.createdAt.getTime(),
    lastLoginAt: null as number | null,
    // P5-4: UI language preference.
    locale: (u as unknown as { locale?: string | null }).locale ?? "zh-CN",
    // P3-2: OAuth provider links (provider -> providerAccountId).
    oauthLinks: (u as unknown as { oauthLinks?: Record<string, string> | null }).oauthLinks ?? undefined,
  };
  store.users.set(u.id, user);
  store.emailIndex.set(u.email.toLowerCase(), u.id);
}

function hydrateKb(kb: PrismaKb): void {
  const g = globalThis as unknown as { __KAI_KB_STORE__?: { kbs: Map<string, unknown>; docs: Map<string, unknown>; seeded: boolean } };
  if (!g.__KAI_KB_STORE__) return;
  const settings = (kb.settings as Record<string, number>) ?? {};
  g.__KAI_KB_STORE__.kbs.set(kb.id, {
    id: kb.id,
    name: kb.name,
    desc: kb.description ?? "",
    color: "from-primary/15",
    initial: kb.name.charAt(0) || "K",
    ownerId: kb.ownerId,
    // P4-3: the KnowledgeBase table has no workspaceId column (memory-only
    // field); DB rows belong to the default workspace, same as in-memory
    // creation. Without it the tenant filter hides every hydrated KB.
    workspaceId: (kb as unknown as { workspaceId?: string | null }).workspaceId ?? "ws_default",
    createdAt: kb.createdAt.getTime(),
    updatedAt: kb.updatedAt.getTime(),
    settings: {
      chunkSize: settings.chunkSize ?? 500,
      chunkOverlap: settings.chunkOverlap ?? 50,
      embeddingModel: settings.embeddingModel ?? "text-embedding-3-small",
      topK: settings.topK ?? 5,
    },
  });
}

function hydrateDoc(d: PrismaDoc): void {
  const g = globalThis as unknown as { __KAI_KB_STORE__?: { kbs: Map<string, unknown>; docs: Map<string, unknown>; seeded: boolean } };
  if (!g.__KAI_KB_STORE__) return;
  g.__KAI_KB_STORE__.docs.set(d.id, {
    id: d.id,
    kbId: d.kbId,
    name: d.name,
    type: d.type,
    size: d.size,
    status: d.status,
    progress: d.progress,
    chunks: d.chunks,
    url: d.url ?? undefined,
    content: d.content ?? undefined,
    uploadedAt: d.uploadedAt.getTime(),
  });
}

function hydrateTask(t: PrismaAgentTask): void {
  const g = globalThis as unknown as { __KAI_AGENT_STORE__?: { tasks: Map<string, unknown> } };
  if (!g.__KAI_AGENT_STORE__) return;
  const row = t as unknown as {
    workspaceId?: string | null;
    kbName?: string | null;
    agents?: unknown[] | null;
    maxSteps?: number | null;
    template?: string | null;
    updatedAt?: Date | null;
  };
  g.__KAI_AGENT_STORE__.tasks.set(t.id, {
    id: t.id,
    topic: t.topic,
    kbId: t.kbId ?? undefined,
    kbName: row.kbName ?? undefined,
    // P4-3: persisted column since the agent_task_extended migration - the
    // default keeps rows written before the migration in the right tenant.
    workspaceId: row.workspaceId ?? "ws_default",
    outputFormat: t.outputFormat,
    // P2-1: workflow config persisted so the separate worker process can run
    // tasks created by the web process (cross-process consistency).
    agents: (row.agents as string[] | null) ?? ["planner", "searcher", "analyzer", "writer"],
    maxSteps: row.maxSteps ?? 5,
    template: row.template ?? undefined,
    status: t.status,
    report: t.report ?? undefined,
    outline: t.outline as string[] ?? [],
    citations: t.citations as unknown[] ?? [],
    steps: t.steps as unknown[] ?? [],
    durationMs: t.durationMs ?? undefined,
    shareConfig: (t.shareConfig as Record<string, unknown> | null) ?? undefined,
    versions: (t.versions as unknown[] | null) ?? undefined,
    comments: (t.comments as unknown[] | null) ?? undefined,
    createdAt: t.createdAt.getTime(),
    updatedAt: (row.updatedAt ?? t.createdAt).getTime(),
    userId: t.userId,
  });
}

/** Ensure hydration has run. Call from API route middleware. */
export async function ensureHydrated(): Promise<void> {
  if (!isDbEnabled() || _hydrated) return;
  await hydrateFromDb();
}

// ── Extended hydration for additional models ─────────────────────────────

/** Hydrate conversations + messages from DB. */
async function hydrateConversations(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const convs = await (db as unknown as {
      conversation: { findMany: (o?: unknown) => Promise<unknown[]> };
    }).conversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    const g = globalThis as unknown as { __KAI_CHAT_STORE__?: { conversations: Map<string, unknown> } };
    if (!g.__KAI_CHAT_STORE__) return 0;
    for (const c of convs as unknown as { id: string; kbId: string; userId: string; title: string; createdAt: Date; updatedAt: Date; shared: boolean; workspaceId: string; archived: boolean; tags: string[] }[]) {
      // Load messages for this conversation
      const msgs = await (db as unknown as {
        message: { findMany: (o: unknown) => Promise<unknown[]> };
      }).message.findMany({
        where: { conversationId: c.id },
        orderBy: { createdAt: "asc" },
      });
      g.__KAI_CHAT_STORE__.conversations.set(c.id, {
        id: c.id,
        kbId: c.kbId,
        title: c.title,
        userId: c.userId,
        createdAt: c.createdAt.getTime(),
        updatedAt: c.updatedAt.getTime(),
        // P5-3: hydrate the persisted P4-1/P4-3 fields (shared/workspaceId
        // used to be memory-only and were lost on restart) + archived/tags.
        shared: c.shared ?? undefined,
        workspaceId: c.workspaceId ?? "ws_default",
        archived: c.archived ?? undefined,
        tags: c.tags ?? undefined,
        messages: (msgs as unknown as { id: string; role: string; content: string; citations: unknown; createdAt: Date; feedback: string | null; feedbackNote: string | null; feedbackAt: Date | null }[]).map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations,
          createdAt: m.createdAt.getTime(),
          feedback: m.feedback ?? undefined,
          feedbackNote: m.feedbackNote ?? undefined,
          feedbackAt: m.feedbackAt ? m.feedbackAt.getTime() : undefined,
        })),
      });
    }
    return convs.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateConversations error");
    return 0;
  }
}

/** Hydrate model configs from DB. The store is Map<userId, Map<id, ModelConfig>>. */
async function hydrateModelConfigs(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const configs = await (db as unknown as {
      modelConfig: { findMany: (o?: unknown) => Promise<unknown[]> };
    }).modelConfig.findMany({});
    const g = globalThis as unknown as { __KAI_MODEL_STORE__?: Map<string, Map<string, unknown>> };
    if (!g.__KAI_MODEL_STORE__) return 0;
    const store = g.__KAI_MODEL_STORE__;
    let count = 0;
    for (const c of configs as unknown as { id: string; userId: string; name: string; provider: string; providerName: string; apiKey: string; baseUrl: string; chatModel: string; embeddingModel: string; enabled: boolean; isDefault: boolean; lastTestedAt: Date | null; lastTestOk: boolean | null; createdAt: Date }[]) {
      let inner = store.get(c.userId);
      if (!inner) {
        inner = new Map();
        store.set(c.userId, inner);
      }
      inner.set(c.id, {
        id: c.id,
        userId: c.userId,
        name: c.name,
        provider: c.provider,
        providerName: c.providerName,
        // P3-4: model keys are stored encrypted in the DB (persistModelConfig);
        // decrypt back to plaintext in memory. Legacy plaintext rows pass
        // through unchanged via decryptFromString's plaintext fallback.
        apiKey: decryptFromString(c.apiKey),
        baseUrl: c.baseUrl,
        chatModel: c.chatModel,
        embeddingModel: c.embeddingModel,
        enabled: c.enabled,
        isDefault: c.isDefault,
        lastTestedAt: c.lastTestedAt?.getTime() ?? null,
        lastTestOk: c.lastTestOk,
        createdAt: c.createdAt.getTime(),
      });
      count++;
    }
    return count;
  } catch (err) {
    log.error({ err }, "[db] hydrateModelConfigs error");
    return 0;
  }
}

/** Hydrate the P3-4 security audit trail (newest first, chain verified). */
async function hydrateAudit(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const rows = await (db as unknown as {
      securityAudit: { findMany: (o?: unknown) => Promise<unknown[]> };
    }).securityAudit.findMany({ orderBy: { createdAt: "desc" } });
    const events = (rows as unknown as {
      id: string; actorId: string | null; actor: string; action: string;
      target: string; detail: string; ip: string | null;
      prevHash: string; hash: string; createdAt: Date;
    }[]).map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actor: r.actor,
      action: r.action,
      target: r.target,
      detail: r.detail,
      ip: r.ip,
      prevHash: r.prevHash,
      hash: r.hash,
      createdAt: r.createdAt.getTime(),
    }));
    // Seed the audit store directly (globalThis pattern, same as the other
    // hydrators) - this keeps db/ free of store-module imports. Chain
    // integrity is verified per-query by GET /api/admin/audit.
    const g = globalThis as unknown as { __KAI_AUDIT_STORE__?: unknown[] };
    g.__KAI_AUDIT_STORE__ = events as unknown[];
    return events.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateAudit error");
    return 0;
  }
}

/** Hydrate notifications from DB. */
async function hydrateNotifications(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const notifs = await (db as unknown as {
      notification: { findMany: (o?: unknown) => Promise<unknown[]> };
    }).notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const g = globalThis as unknown as { __KAI_NOTIF_STORE__?: { notificationsByUser: Map<string, unknown[]> } };
    if (!g.__KAI_NOTIF_STORE__) return 0;
    let count = 0;
    for (const n of notifs as unknown as { id: string; userId: string; type: string; title: string; body: string; read: boolean; link: string | null; createdAt: Date }[]) {
      const list = g.__KAI_NOTIF_STORE__.notificationsByUser.get(n.userId) ?? [];
      list.push({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        read: n.read,
        createdAt: n.createdAt.getTime(),
        link: n.link ?? undefined,
      });
      g.__KAI_NOTIF_STORE__.notificationsByUser.set(n.userId, list);
      count++;
    }
    return count;
  } catch (err) {
    log.error({ err }, "[db] hydrateNotifications error");
    return 0;
  }
}

// ── Team hydration (team info + members + audit + kbAccess) ──────────────

async function hydrateTeam(): Promise<{ team: number; members: number; audit: number }> {
  const db = await getDb();
  if (!db) return { team: 0, members: 0, audit: 0 };
  const g = globalThis as unknown as {
    __KAI_TEAM_STORE__?: {
      team: { id: string; name: string; logoInitial: string; plan: string; createdAt: number };
      members: Map<string, unknown>;
      audit: unknown[];
      kbAccess: Map<string, string>;
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
async function hydrateWorkspace(): Promise<number> {
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
      store.set(w.id, {
        id: w.id,
        name: w.name,
        plan: w.plan,
        ownerId: w.ownerId,
        brandColor: w.brandColor ?? "indigo",
        members: existing?.members ?? [],
        createdAt: existing?.createdAt ?? w.createdAt.getTime(),
      });
    }
    return rows.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateWorkspace error");
    return 0;
  }
}

// ── P7-1: Webhook subscription hydration ──────────────────────────────────

/**
 * Merge DB webhook subscription rows into __KAI_WEBHOOK_STORE__ so configured
 * endpoints + delivery state survive restarts. Subscriptions created in a
 * previous process land in the store; memory-only delivery records stay lost
 * (they are a short ring buffer by design).
 */
async function hydrateWebhookSubscriptions(): Promise<number> {
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
    return 0;
  }
}

// ── Admin SystemConfig hydration ─────────────────────────────────────────

async function hydrateSystemConfig(): Promise<boolean> {
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
    return false;
  }
}

// ── P7-2: Bot integration hydration ───────────────────────────────────────

/**
 * Merge DB bot rows into __KAI_BOT_STORE__ so bindings survive restarts.
 * The plaintext token is intentionally not stored anywhere - only the hash,
 * so hydrated bindings can verify callbacks but cannot re-reveal the token.
 */
async function hydrateBotIntegrations(): Promise<number> {
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
    return 0;
  }
}

// ── P7-3: Knowledge-graph hydration ───────────────────────────────────────

/**
 * Merge DB graph rows into __KAI_GRAPH_STORE__ so extracted entities and
 * relations survive restarts. Per-doc contribution maps are memory-only
 * (rebuilt on the next re-index), so hydrate only fills entities/relations
 * and the label index.
 */
async function hydrateKnowledgeGraph(): Promise<number> {
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
    return 0;
  }
}

/** Hydrate API keys from DB (secrets stay encrypted at rest - decrypt here). */
async function hydrateApiKeys(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const g = globalThis as unknown as { __KAI_APIKEY_STORE__?: { keys: Array<Record<string, unknown>> } };
  if (!g.__KAI_APIKEY_STORE__) return 0;
  try {
    const rows = await (db as unknown as {
      apiKey: { findMany: (o?: unknown) => Promise<unknown[]> };
    }).apiKey.findMany({ orderBy: { createdAt: "desc" } });
    const store = g.__KAI_APIKEY_STORE__;
    const seen = new Set(store.keys.map((k) => k.id));
    for (const r of rows as unknown as {
      id: string; userId: string; name: string; secret: string; prefix: string;
      scopes: string[]; status: string; calls: number; lastUsed: Date | null; createdAt: Date;
    }[]) {
      if (seen.has(r.id)) continue;
      store.keys.push({
        id: r.id,
        userId: r.userId,
        name: r.name,
        secret: isEncrypted(r.secret) ? decryptFromString(r.secret) : r.secret,
        prefix: r.prefix,
        scopes: r.scopes,
        status: r.status,
        calls: r.calls,
        lastUsed: r.lastUsed ? r.lastUsed.getTime() : null,
        createdAt: r.createdAt.getTime(),
      });
    }
    return store.keys.length;
  } catch (err) {
    log.error({ err }, "[db] hydrateApiKeys error");
    return 0;
  }
}

/** Hydrate subscriptions / invoices / orders so billing pages show history
 *  after restart. Usage counters are runtime metrics and stay in memory. */
async function hydrateBilling(): Promise<number> {
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
    return 0;
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
