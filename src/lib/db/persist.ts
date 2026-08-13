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

import { getDb, isDbEnabled } from "./client";
import { encryptToString } from "@/lib/security/crypto";
import { log } from "@/lib/obs/log";

/** Persist a user create/update to DB. */
export async function persistUser(user: {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  role: string;
  status: string;
  plan: string;
  createdAt: number;
  lastLoginAt: number | null;
  /** P5-4: UI language preference. */
  locale?: string;
  /** P3-2: OAuth provider links (provider -> providerAccountId). */
  oauthLinks?: Record<string, string>;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const existing = await db.user.findUnique({ where: { id: user.id } });
    const data = {
      email: user.email,
      name: user.name,
      passwordHash: user.passwordHash,
      role: user.role.toUpperCase(),
      status: user.status.toUpperCase(),
      locale: user.locale ?? "zh-CN",
      // OAuth links: JSONB column; null keeps rows backwards compatible.
      oauthLinks: user.oauthLinks ?? null,
    };
    if (existing) {
      await db.user.update({ where: { id: user.id }, data });
    } else {
      await db.user.create({ data: { id: user.id, ...data } });
    }
  } catch (err) {
    log.error({ err }, "[db] persistUser error");
  }
}

/** Persist a KB create/update to DB. */
export async function persistKb(kb: {
  id: string;
  name: string;
  desc: string;
  ownerId: string;
  settings: object;
  createdAt: number;
  updatedAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const existing = await db.knowledgeBase.findUnique({ where: { id: kb.id } });
    const data = {
      name: kb.name,
      description: kb.desc,
      ownerId: kb.ownerId,
      settings: kb.settings,
      updatedAt: new Date(kb.updatedAt),
    };
    if (existing) {
      await db.knowledgeBase.update({ where: { id: kb.id }, data });
    } else {
      await db.knowledgeBase.create({
        data: { id: kb.id, ...data, createdAt: new Date(kb.createdAt) },
      });
    }
  } catch (err) {
    log.error({ err }, "[db] persistKb error");
  }
}

/** Delete a KB from DB. */
export async function deleteKbFromDb(kbId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.knowledgeBase.delete({ where: { id: kbId } }).catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] deleteKbFromDb error");
  }
}

/** Persist a document create/update to DB. */
export async function persistDoc(doc: {
  id: string;
  kbId: string;
  name: string;
  type: string;
  size: number;
  status: string;
  progress: number;
  chunks: number;
  url?: string;
  content?: string;
  uploadedAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const existing = await db.kbDocument.findUnique({ where: { id: doc.id } });
    const data = {
      name: doc.name,
      type: doc.type,
      size: doc.size,
      status: doc.status,
      progress: doc.progress,
      chunks: doc.chunks,
      url: doc.url ?? null,
      content: doc.content ?? null,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.kbDocument.update({ where: { id: doc.id }, data });
    } else {
      await db.kbDocument.create({
        data: { id: doc.id, kbId: doc.kbId, ...data, uploadedAt: new Date(doc.uploadedAt) },
      });
    }
  } catch (err) {
    log.error({ err }, "[db] persistDoc error");
  }
}

/** Delete a document from DB. */
export async function deleteDocFromDb(docId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.kbDocument.delete({ where: { id: docId } }).catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] deleteDocFromDb error");
  }
}

/** Persist an agent task to DB. */
export async function persistTask(task: {
  id: string;
  userId?: string;
  topic: string;
  kbId?: string;
  outputFormat: string;
  status: string;
  report?: string;
  outline: string[];
  citations: unknown[];
  steps: unknown[];
  durationMs?: number;
  createdAt: number;
  shareConfig?: unknown;
  versions?: unknown;
  comments?: unknown;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const existing = await db.agentTask.findUnique({ where: { id: task.id } });
    const data = {
      topic: task.topic,
      kbId: task.kbId ?? null,
      outputFormat: task.outputFormat,
      status: task.status,
      report: task.report ?? null,
      outline: task.outline,
      citations: task.citations,
      steps: task.steps,
      durationMs: task.durationMs ?? null,
      shareConfig: task.shareConfig ?? null,
      versions: task.versions ?? null,
      comments: task.comments ?? null,
    };
    if (existing) {
      await db.agentTask.update({ where: { id: task.id }, data });
    } else {
      await db.agentTask.create({
        data: { id: task.id, userId: task.userId, ...data, createdAt: new Date(task.createdAt) },
      });
    }
  } catch (err) {
    log.error({ err }, "[db] persistTask error");
  }
}

/** Persist an API key to DB. */
export async function persistApiKey(key: {
  id: string;
  userId: string;
  name: string;
  secret: string;
  prefix: string;
  scopes: string[];
  status: string;
  calls: number;
  lastUsed: number | null;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const existing = await db.apiKey.findUnique({ where: { id: key.id } });
    const data = {
      name: key.name,
      keyHash: key.secret,  // store the secret as keyHash in DB
      prefix: key.prefix,
      scopes: key.scopes,
      status: key.status,
      calls: key.calls,
      lastUsed: key.lastUsed ? new Date(key.lastUsed) : null,
    };
    if (existing) {
      await db.apiKey.update({ where: { id: key.id }, data });
    } else {
      await db.apiKey.create({
        data: { id: key.id, userId: key.userId, ...data, createdAt: new Date(key.createdAt) },
      });
    }
  } catch (err) {
    log.error({ err }, "[db] persistApiKey error");
  }
}

/** Delete an API key from DB. */
export async function deleteApiKeyFromDb(keyId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.apiKey.delete({ where: { id: keyId } }).catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] deleteApiKeyFromDb error");
  }
}

// ── Chat: Conversations + Messages ───────────────────────────────────────

/** Persist a conversation (with messages) to DB. */
export async function persistConversation(conv: {
  id: string;
  kbId: string;
  title: string;
  userId?: string;
  createdAt: number;
  updatedAt: number;
  messages: { id: string; role: string; content: string; citations?: unknown; createdAt: number }[];
  shared?: boolean;
  workspaceId?: string;
  archived?: boolean;
  tags?: string[];
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    // Upsert conversation
    const existing = await (db as unknown as { conversation: { findUnique: (o: unknown) => Promise<unknown> } })
      .conversation.findUnique({ where: { id: conv.id } });
    const data = {
      kbId: conv.kbId,
      userId: conv.userId || "unknown",
      title: conv.title,
      updatedAt: new Date(conv.updatedAt),
      // P5-3: persist the P4-1/P4-3 fields that used to be memory-only
      // (shared/workspaceId were lost on restart; archived/tags are new).
      shared: conv.shared ?? false,
      workspaceId: conv.workspaceId ?? "ws_default",
      archived: conv.archived ?? false,
      tags: conv.tags ?? [],
    };
    if (existing) {
      await (db as unknown as { conversation: { update: (o: unknown) => Promise<unknown> } })
        .conversation.update({ where: { id: conv.id }, data });
    } else {
      await (db as unknown as { conversation: { create: (o: unknown) => Promise<unknown> } })
        .conversation.create({ data: { id: conv.id, ...data, createdAt: new Date(conv.createdAt) } });
    }
    // Persist latest message only (fire-and-forget, avoid full resync)
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (lastMsg) {
      await (db as unknown as { message: { create: (o: unknown) => Promise<unknown> } })
        .message.create({
          data: {
            id: lastMsg.id,
            conversationId: conv.id,
            role: lastMsg.role,
            content: lastMsg.content,
            citations: lastMsg.citations ?? null,
            createdAt: new Date(lastMsg.createdAt),
          },
        }).catch(() => {});
    }
  } catch (err) {
    log.error({ err }, "[db] persistConversation error");
  }
}

/** Persist feedback on a single message (P5-3). Upserts by message id so
 *  feedback on historical answers survives restarts. */
export async function persistMessageFeedback(
  convId: string,
  msg: { id: string; role: string; content: string; citations?: unknown; createdAt: number; feedback?: string; feedbackNote?: string; feedbackAt?: number }
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { message: { upsert: (o: unknown) => Promise<unknown> } })
      .message.upsert({
        where: { id: msg.id },
        create: {
          id: msg.id,
          conversationId: convId,
          role: msg.role,
          content: msg.content,
          citations: msg.citations ?? null,
          feedback: msg.feedback ?? null,
          feedbackNote: msg.feedbackNote ?? null,
          feedbackAt: msg.feedbackAt ? new Date(msg.feedbackAt) : null,
          createdAt: new Date(msg.createdAt),
        },
        update: {
          feedback: msg.feedback ?? null,
          feedbackNote: msg.feedbackNote ?? null,
          feedbackAt: msg.feedbackAt ? new Date(msg.feedbackAt) : null,
        },
      });
  } catch (err) {
    log.error({ err }, "[db] persistMessageFeedback error");
  }
}

/** Delete a conversation from DB. */
export async function deleteConversationFromDb(convId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { conversation: { delete: (o: unknown) => Promise<unknown> } })
      .conversation.delete({ where: { id: convId } }).catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] deleteConversationFromDb error");
  }
}

/** Delete a single message from DB (P5-3 regenerate replaces the old answer). */
export async function deleteMessageFromDb(messageId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { message: { delete: (o: unknown) => Promise<unknown> } })
      .message.delete({ where: { id: messageId } }).catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] deleteMessageFromDb error");
  }
}

// ── Billing: Subscription + Invoice + Order ──────────────────────────────

/** Persist a subscription to DB. */
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
    const existing = await (db as unknown as { subscription: { findUnique: (o: unknown) => Promise<unknown> } })
      .subscription.findUnique({ where: { userId: sub.userId } });
    if (existing) {
      await (db as unknown as { subscription: { update: (o: unknown) => Promise<unknown> } })
        .subscription.update({ where: { userId: sub.userId }, data });
    } else {
      await (db as unknown as { subscription: { create: (o: unknown) => Promise<unknown> } })
        .subscription.create({ data: { userId: sub.userId, ...data } });
    }
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
      }).catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] persistInvoice error");
  }
}

// ── Security: Sessions + Login Events ────────────────────────────────────

/** Persist a login event to DB. */
export async function persistLoginEvent(event: {
  userId: string;
  device: string;
  ip: string;
  location?: string;
  success: boolean;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { loginEvent: { create: (o: unknown) => Promise<unknown> } })
      .loginEvent.create({
        data: {
          userId: event.userId,
          device: event.device,
          ip: event.ip,
          location: event.location ?? null,
          success: event.success,
        },
      }).catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] persistLoginEvent error");
  }
}

// ── Notifications ─────────────────────────────────────────────────────────

/** Persist a notification to DB. */
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
    await (db as unknown as { notification: { create: (o: unknown) => Promise<unknown> } })
      .notification.create({
        data: {
          id: notif.id,
          userId: notif.userId,
          type: notif.type,
          title: notif.title,
          body: notif.body,
          read: notif.read,
          link: notif.link ?? null,
          createdAt: new Date(notif.createdAt),
        },
      }).catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] persistNotification error");
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
    const existing = await (db as unknown as { modelConfig: { findUnique: (o: unknown) => Promise<unknown> } })
      .modelConfig.findUnique({ where: { id: config.id } });
    if (existing) {
      await (db as unknown as { modelConfig: { update: (o: unknown) => Promise<unknown> } })
        .modelConfig.update({ where: { id: config.id }, data });
    } else {
      await (db as unknown as { modelConfig: { create: (o: unknown) => Promise<unknown> } })
        .modelConfig.create({ data: { id: config.id, userId: config.userId, ...data, createdAt: new Date(config.createdAt) } });
    }
  } catch (err) {
    log.error({ err }, "[db] persistModelConfig error");
  }
}

/** Delete a model config from DB. */
export async function deleteModelConfigFromDb(id: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { modelConfig: { delete: (o: unknown) => Promise<unknown> } })
      .modelConfig.delete({ where: { id } }).catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] deleteModelConfigFromDb error");
  }
}

// ── Team: Team info + Members + Audit + KbAccess ─────────────────────────

/** Persist (upsert) the team row. */
export async function persistTeam(team: {
  id: string;
  name: string;
  logoInitial: string;
  plan: string;
  kbAccess: Record<string, string>;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      name: team.name,
      logoInitial: team.logoInitial,
      plan: team.plan,
      kbAccess: team.kbAccess as unknown,
      updatedAt: new Date(),
    };
    const t = db as unknown as {
      team: {
        findUnique: (o: unknown) => Promise<unknown>;
        update: (o: unknown) => Promise<unknown>;
        create: (o: unknown) => Promise<unknown>;
      };
    };
    const existing = await t.team.findUnique({ where: { id: team.id } });
    if (existing) {
      await t.team.update({ where: { id: team.id }, data });
    } else {
      await t.team.create({
        data: { id: team.id, ...data, createdAt: new Date(team.createdAt) },
      });
    }
  } catch (err) {
    log.error({ err }, "[db] persistTeam error");
  }
}

// ── Workspace (P4-3 tenant / P5-5 brand color) ────────────────────────────

/** Persist (upsert) a workspace row. */
export async function persistWorkspace(ws: {
  id: string;
  name: string;
  plan: string;
  ownerId: string;
  brandColor: string;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      name: ws.name,
      plan: ws.plan,
      ownerId: ws.ownerId,
      brandColor: ws.brandColor,
      updatedAt: new Date(),
    };
    const existing = await db.workspace.findUnique({ where: { id: ws.id } });
    if (existing) {
      await db.workspace.update({ where: { id: ws.id }, data });
    } else {
      await db.workspace.create({
        data: { id: ws.id, ...data, createdAt: new Date(ws.createdAt) },
      });
    }
  } catch (err) {
    log.error({ err }, "[db] persistWorkspace error");
  }
}

/** Append an audit log entry. */
export async function persistAuditEntry(
  entry: { id: string; actor: string; action: string; target: string; detail: string; createdAt: number },
  teamId = "team_default"
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const a = db as unknown as { auditLog: { create: (o: unknown) => Promise<unknown> } };
    await a.auditLog
      .create({
        data: {
          id: entry.id,
          teamId,
          actorId: null,
          actor: entry.actor,
          target: entry.target,
          action: entry.action,
          detail: entry.detail,
          createdAt: new Date(entry.createdAt),
        },
      })
      .catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] persistAuditEntry error");
  }
}

/** Append a SecurityAudit event (P3-4 global audit trail, hash-chained). */
export async function persistAuditEvent(ev: {
  id: string;
  actorId: string | null;
  actor: string;
  action: string;
  target: string;
  detail: string;
  ip: string | null;
  prevHash: string;
  hash: string;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const a = db as unknown as { securityAudit: { create: (o: unknown) => Promise<unknown> } };
    await a.securityAudit.create({
      data: {
        id: ev.id,
        actorId: ev.actorId,
        actor: ev.actor,
        action: ev.action,
        target: ev.target,
        detail: ev.detail,
        ip: ev.ip,
        prevHash: ev.prevHash,
        hash: ev.hash,
        createdAt: new Date(ev.createdAt),
      },
    });
  } catch (err) {
    log.error({ err }, "[db] persistAuditEvent error");
  }
}

/**
 * Best-effort persist of a team member. Resolves userId by email; demo
 * members without a User account are skipped (no FK target).
 */
export async function persistTeamMember(
  member: { id: string; email: string; role: string; joinedAt: number },
  teamId = "team_default"
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const user = await db.user.findUnique({ where: { email: member.email } });
    if (!user) return; // demo-only member, no user account -> skip
    const tm = db as unknown as {
      teamMember: {
        upsert: (o: unknown) => Promise<unknown>;
        delete: (o: unknown) => Promise<unknown>;
      };
    };
    const role = member.role.toUpperCase();
    await tm.teamMember
      .upsert({
        where: { teamId_userId: { teamId, userId: user.id } },
        update: { role: role as never },
        create: {
          id: member.id,
          teamId,
          userId: user.id,
          role: role as never,
          joinedAt: new Date(member.joinedAt),
        },
      })
      .catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] persistTeamMember error");
  }
}

/** Delete a team member row (best-effort). */
export async function deleteTeamMemberFromDb(memberId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const tm = db as unknown as { teamMember: { delete: (o: unknown) => Promise<unknown> } };
    await tm.teamMember.delete({ where: { id: memberId } }).catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] deleteTeamMemberFromDb error");
  }
}

// ── Admin: System Config (single-row) ────────────────────────────────────

/** Persist (upsert) the single SystemConfig row. */
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
        findUnique: (o: unknown) => Promise<unknown>;
        update: (o: unknown) => Promise<unknown>;
        create: (o: unknown) => Promise<unknown>;
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
    const existing = await wh.webhookSubscription.findUnique({ where: { id: sub.id } });
    if (existing) {
      await wh.webhookSubscription.update({ where: { id: sub.id }, data });
    } else {
      await wh.webhookSubscription.create({ data: { id: sub.id, createdAt: new Date(sub.createdAt), ...data } });
    }
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
    await wh.webhookSubscription.delete({ where: { id } }).catch(() => {});
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
        findUnique: (o: unknown) => Promise<unknown>;
        update: (o: unknown) => Promise<unknown>;
        create: (o: unknown) => Promise<unknown>;
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
    const existing = await bi.botIntegration.findUnique({ where: { id: bot.id } });
    if (existing) {
      await bi.botIntegration.update({ where: { id: bot.id }, data });
    } else {
      await bi.botIntegration.create({ data: { id: bot.id, createdAt: new Date(bot.createdAt), ...data } });
    }
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
    await bi.botIntegration.delete({ where: { id } }).catch(() => {});
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
        findUnique: (o: unknown) => Promise<unknown>;
        update: (o: unknown) => Promise<unknown>;
        create: (o: unknown) => Promise<unknown>;
      };
    };
    const data = {
      kbId: entity.kbId,
      label: entity.label,
      type: entity.type,
      mentions: entity.mentions,
      docIds: entity.docIds,
    };
    const existing = await ke.knowledgeEntity.findUnique({ where: { id: entity.id } });
    if (existing) {
      await ke.knowledgeEntity.update({ where: { id: entity.id }, data });
    } else {
      await ke.knowledgeEntity.create({ data: { id: entity.id, createdAt: new Date(entity.createdAt), ...data } });
    }
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
        findUnique: (o: unknown) => Promise<unknown>;
        update: (o: unknown) => Promise<unknown>;
        create: (o: unknown) => Promise<unknown>;
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
    const existing = await kr.knowledgeRelation.findUnique({ where: { id: relation.id } });
    if (existing) {
      await kr.knowledgeRelation.update({ where: { id: relation.id }, data });
    } else {
      await kr.knowledgeRelation.create({ data: { id: relation.id, createdAt: new Date(relation.createdAt), ...data } });
    }
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
    await ke.knowledgeEntity.delete({ where: { id } }).catch(() => {});
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
    await kr.knowledgeRelation.delete({ where: { id } }).catch(() => {});
  } catch (err) {
    log.error({ err }, "[db] deleteRelationFromDb error");
  }
}
