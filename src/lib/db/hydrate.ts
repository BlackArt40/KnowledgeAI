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
import type { PrismaUser, PrismaKb, PrismaDoc, PrismaAgentTask } from "./types";

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

  console.log("[db] Hydrating in-memory stores from PostgreSQL...");
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

    _hydrated = true;
    console.log(
      `[db] Hydration complete: ${counts.users} users, ${counts.kbs} KBs, ${counts.docs} docs, ${counts.tasks} tasks, ${convs} convs, ${models} models, ${notifs} notifs, team={${team.team}t/${team.members}m/${team.audit}a}, admin=${admin}`
    );
  } catch (err) {
    console.error("[db] Hydration failed:", err);
    // Don't set _hydrated = true so it retries on next request
  }
}

// ── Per-model hydration helpers ──────────────────────────────────────────

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
  g.__KAI_AGENT_STORE__.tasks.set(t.id, {
    id: t.id,
    topic: t.topic,
    kbId: t.kbId ?? undefined,
    outputFormat: t.outputFormat,
    status: t.status,
    report: t.report ?? undefined,
    outline: t.outline as string[] ?? [],
    citations: t.citations as unknown[] ?? [],
    steps: t.steps as unknown[] ?? [],
    durationMs: t.durationMs ?? undefined,
    createdAt: t.createdAt.getTime(),
    updatedAt: t.createdAt.getTime(),
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
    for (const c of convs as unknown as { id: string; kbId: string; userId: string; title: string; createdAt: Date; updatedAt: Date }[]) {
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
        messages: (msgs as unknown as { id: string; role: string; content: string; citations: unknown; createdAt: Date }[]).map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations,
          createdAt: m.createdAt.getTime(),
        })),
      });
    }
    return convs.length;
  } catch (err) {
    console.error("[db] hydrateConversations error:", err);
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
        apiKey: c.apiKey,
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
    console.error("[db] hydrateModelConfigs error:", err);
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
    console.error("[db] hydrateNotifications error:", err);
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
    console.error("[db] hydrateTeam error:", err);
    return { team: 0, members: 0, audit: 0 };
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
    };
    return true;
  } catch (err) {
    console.error("[db] hydrateSystemConfig error:", err);
    return false;
  }
}
