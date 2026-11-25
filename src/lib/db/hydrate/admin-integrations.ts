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







import { mergeApiKeyRow, type ApiKeyRow } from "@/lib/apikeys/store";

import { log } from "@/lib/obs/log";


// P1-9: coalesce concurrent first-request calls (the proxy fires
// ensureHydrated() fire-and-forget on every request) into a single in-flight
// hydration promise - the old code ran hydrateFromDb() N times in parallel,
// duplicating rows in the in-memory stores. Reset on settle so a FAILED
// hydration (see P1-10) retries on the next request.

/** Whether hydration has been completed. */
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

