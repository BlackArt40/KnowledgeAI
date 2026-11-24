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
import { encryptToString } from "@/lib/crypto";
import { log } from "@/lib/obs/log";

/**
 * Best-effort persistence helper. Deletes are idempotent, so a P2025 ("row not
 * found") is expected and ignored; every other failure is logged. Previously
 * these paths used `.catch((err) => bestEffort(err))`, which silently diverged memory from DB.
 */
import { bestEffort } from "./core";

export async function persistSystemConfig(config: {
  defaultModel: string;
  embeddingModel: string;
  rateLimitPerMin: number;
  maxUploadMb: number;
  maintenanceMode: boolean;
  allowSignup: boolean;
  required2FARoles: string[];
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const sc = db as unknown as {
      systemConfig: {
        findUnique: (o: unknown) => Promise<unknown>;
        update: (o: unknown) => Promise<unknown>;
        create: (o: unknown) => Promise<unknown>;
      };
    };
    const data = {
      id: 1,
      defaultModel: config.defaultModel,
      embeddingModel: config.embeddingModel,
      rateLimitPerMin: config.rateLimitPerMin,
      maxUploadMb: config.maxUploadMb,
      maintenanceMode: config.maintenanceMode,
      allowSignup: config.allowSignup,
      required2FARoles: config.required2FARoles,
    };
    const existing = await sc.systemConfig.findUnique({ where: { id: 1 } });
    if (existing) {
      await sc.systemConfig.update({ where: { id: 1 }, data });
    } else {
      await sc.systemConfig.create({ data });
    }
  } catch (err) {
    log.error({ err }, "[db] persistSystemConfig error");
  }
}

// ── P7-1: Webhook subscriptions ───────────────────────────────────────────

/** Persist (upsert) a webhook subscription. */

export async function persistWebhookSubscription(sub: {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: number;
  lastDeliveryAt: number | null;
  failures: number;
  lastError: string | null;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const wh = db as unknown as {
      webhookSubscription: {
        upsert: (o: unknown) => Promise<unknown>;
      };
    };
    const data = {
      userId: sub.userId,
      workspaceId: sub.workspaceId,
      name: sub.name,
      url: sub.url,
      secret: sub.secret,
      events: sub.events,
      active: sub.active,
      lastDeliveryAt: sub.lastDeliveryAt ? new Date(sub.lastDeliveryAt) : null,
      failures: sub.failures,
      lastError: sub.lastError,
    };
    await wh.webhookSubscription.upsert({
      where: { id: sub.id },
      update: data,
      create: { id: sub.id, createdAt: new Date(sub.createdAt), ...data },
    });
  } catch (err) {
    log.error({ err }, "[db] persistWebhookSubscription error");
  }
}

/** Delete a webhook subscription row. */

export async function deleteWebhookSubscriptionFromDb(id: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const wh = db as unknown as { webhookSubscription: { delete: (o: unknown) => Promise<unknown> } };
    await wh.webhookSubscription.delete({ where: { id } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteWebhookSubscriptionFromDb error");
  }
}

// ── P7-2: Bot integrations ────────────────────────────────────────────────

/** Persist (upsert) a bot integration binding. */

export async function persistBotIntegration(bot: {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  platform: string;
  kbId: string;
  kbName?: string;
  tokenHash: string;
  active: boolean;
  calls: number;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const bi = db as unknown as {
      botIntegration: {
        upsert: (o: unknown) => Promise<unknown>;
      };
    };
    const data = {
      userId: bot.userId,
      workspaceId: bot.workspaceId,
      name: bot.name,
      platform: bot.platform,
      kbId: bot.kbId,
      kbName: bot.kbName ?? "",
      tokenHash: bot.tokenHash,
      active: bot.active,
      calls: bot.calls,
    };
    await bi.botIntegration.upsert({
      where: { id: bot.id },
      update: data,
      create: { id: bot.id, createdAt: new Date(bot.createdAt), ...data },
    });
  } catch (err) {
    log.error({ err }, "[db] persistBotIntegration error");
  }
}

/** Delete a bot integration row. */

export async function deleteBotIntegrationFromDb(id: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const bi = db as unknown as { botIntegration: { delete: (o: unknown) => Promise<unknown> } };
    await bi.botIntegration.delete({ where: { id } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteBotIntegrationFromDb error");
  }
}

// ── P7-3: Knowledge graph (entities + relations) ──────────────────────────

/** Persist (upsert) a knowledge-graph entity. */

export async function persistEntity(entity: {
  id: string; kbId: string; label: string; type: string;
  mentions: number; docIds: string[]; createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const ke = db as unknown as {
      knowledgeEntity: {
        upsert: (o: unknown) => Promise<unknown>;
      };
    };
    const data = {
      kbId: entity.kbId,
      label: entity.label,
      type: entity.type,
      mentions: entity.mentions,
      docIds: entity.docIds,
    };
    await ke.knowledgeEntity.upsert({
      where: { id: entity.id },
      update: data,
      create: { id: entity.id, createdAt: new Date(entity.createdAt), ...data },
    });
  } catch (err) {
    log.error({ err }, "[db] persistEntity error");
  }
}

/** Persist (upsert) a knowledge-graph relation. */

export async function persistRelation(relation: {
  id: string; kbId: string; source: string; target: string; type: string;
  weight: number; docIds: string[]; createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const kr = db as unknown as {
      knowledgeRelation: {
        upsert: (o: unknown) => Promise<unknown>;
      };
    };
    const data = {
      kbId: relation.kbId,
      source: relation.source,
      target: relation.target,
      type: relation.type,
      weight: relation.weight,
      docIds: relation.docIds,
    };
    await kr.knowledgeRelation.upsert({
      where: { id: relation.id },
      update: data,
      create: { id: relation.id, createdAt: new Date(relation.createdAt), ...data },
    });
  } catch (err) {
    log.error({ err }, "[db] persistRelation error");
  }
}

/** Delete a knowledge-graph entity row. */

export async function deleteEntityFromDb(id: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const ke = db as unknown as { knowledgeEntity: { delete: (o: unknown) => Promise<unknown> } };
    await ke.knowledgeEntity.delete({ where: { id } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteEntityFromDb error");
  }
}

/** Delete a knowledge-graph relation row. */

export async function deleteRelationFromDb(id: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const kr = db as unknown as { knowledgeRelation: { delete: (o: unknown) => Promise<unknown> } };
    await kr.knowledgeRelation.delete({ where: { id } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteRelationFromDb error");
  }
}

export async function deleteNotificationFromDb(id: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { notification: { deleteMany: (o: unknown) => Promise<unknown> } })
      .notification.deleteMany({ where: { id } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteNotificationFromDb error");
  }
}

/** Persist per-user notification preferences. */

export async function deleteModelConfigFromDb(id: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { modelConfig: { delete: (o: unknown) => Promise<unknown> } })
      .modelConfig.delete({ where: { id } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteModelConfigFromDb error");
  }
}

// ── Team: Team info + Members + Audit + KbAccess ─────────────────────────

/** Persist (upsert) the team row. */

export async function persistNotification(notif: {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
  link?: string;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    // upsert: marking read / retries reuse the same id (create() would throw
    // on a duplicate and the notification would never be persisted).
    await (db as unknown as { notification: { upsert: (o: unknown) => Promise<unknown> } })
      .notification.upsert({
        where: { id: notif.id },
        update: {
          read: notif.read,
          title: notif.title,
          body: notif.body,
          link: notif.link ?? null,
        },
        create: {
          id: notif.id,
          userId: notif.userId,
          type: notif.type,
          title: notif.title,
          body: notif.body,
          read: notif.read,
          link: notif.link ?? null,
          createdAt: new Date(notif.createdAt),
        },
      }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] persistNotification error");
  }
}

/** Delete a notification row. */

export async function persistNotificationPrefs(
  userId: string,
  prefs: {
    emailDigest: boolean;
    kbReady: boolean;
    agentDone: boolean;
    securityAlert: boolean;
    teamActivity: boolean;
  }
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { notificationPrefs: { upsert: (o: unknown) => Promise<unknown> } })
      .notificationPrefs.upsert({
        where: { userId },
        update: prefs,
        create: { userId, ...prefs },
      }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] persistNotificationPrefs error");
  }
}

// ── Model Configs ─────────────────────────────────────────────────────────

/** Persist a model config to DB. */

export async function persistModelConfig(config: {
  id: string;
  userId: string;
  name: string;
  provider: string;
  providerName: string;
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  enabled: boolean;
  isDefault: boolean;
  lastTestedAt: number | null;
  lastTestOk: boolean | null;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      name: config.name,
      provider: config.provider,
      providerName: config.providerName,
      // P3-4: never store provider API keys in plaintext - encrypt at rest.
      // hydrateModelConfigs() decrypts on load (legacy plaintext rows pass
      // through decryptFromString's plaintext fallback).
      apiKey: encryptToString(config.apiKey),
      baseUrl: config.baseUrl,
      chatModel: config.chatModel,
      embeddingModel: config.embeddingModel,
      enabled: config.enabled,
      isDefault: config.isDefault,
      lastTestedAt: config.lastTestedAt ? new Date(config.lastTestedAt) : null,
      lastTestOk: config.lastTestOk,
    };
    await (db as unknown as { modelConfig: { upsert: (o: unknown) => Promise<unknown> } })
      .modelConfig.upsert({
        where: { id: config.id },
        update: data,
        create: { id: config.id, userId: config.userId, ...data, createdAt: new Date(config.createdAt) },
      });
  } catch (err) {
    log.error({ err }, "[db] persistModelConfig error");
  }
}

/** Delete a model config from DB. */
