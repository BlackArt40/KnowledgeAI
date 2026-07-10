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

    _hydrated = true;
    console.log(
      `[db] Hydration complete: ${counts.users} users, ${counts.kbs} KBs, ${counts.docs} docs, ${counts.tasks} tasks`
    );
  } catch (err) {
    console.error("[db] Hydration failed:", err);
    // Don't set _hydrated = true so it retries on next request
  }
}

// ── Per-model hydration helpers ──────────────────────────────────────────

function hydrateUser(u: PrismaUser): void {
  const g = globalThis as unknown as { __KAI_AUTH_STORE__?: { users: Map<string, unknown>; emailIndex: Map<string, string>; seeded: boolean } };
  if (!g.__KAI_AUTH_STORE__) return;
  const store = g.__KAI_AUTH_STORE__;
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
