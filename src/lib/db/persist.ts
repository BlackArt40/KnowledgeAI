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

/** Persist a user create/update to DB. */
export async function persistUser(user: {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: string;
  status: string;
  plan: string;
  createdAt: number;
  lastLoginAt: number | null;
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
    };
    if (existing) {
      await db.user.update({ where: { id: user.id }, data });
    } else {
      await db.user.create({ data: { id: user.id, ...data } });
    }
  } catch (err) {
    console.error("[db] persistUser error:", err);
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
    console.error("[db] persistKb error:", err);
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
    console.error("[db] deleteKbFromDb error:", err);
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
    console.error("[db] persistDoc error:", err);
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
    console.error("[db] deleteDocFromDb error:", err);
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
    };
    if (existing) {
      await db.agentTask.update({ where: { id: task.id }, data });
    } else {
      await db.agentTask.create({
        data: { id: task.id, userId: task.userId, ...data, createdAt: new Date(task.createdAt) },
      });
    }
  } catch (err) {
    console.error("[db] persistTask error:", err);
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
    console.error("[db] persistApiKey error:", err);
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
    console.error("[db] deleteApiKeyFromDb error:", err);
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
    console.error("[db] persistConversation error:", err);
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
    console.error("[db] deleteConversationFromDb error:", err);
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
    console.error("[db] persistSubscription error:", err);
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
    console.error("[db] persistInvoice error:", err);
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
    console.error("[db] persistLoginEvent error:", err);
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
    console.error("[db] persistNotification error:", err);
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
      apiKey: config.apiKey,
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
    console.error("[db] persistModelConfig error:", err);
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
    console.error("[db] deleteModelConfigFromDb error:", err);
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
    console.error("[db] persistTeam error:", err);
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
    console.error("[db] persistAuditEntry error:", err);
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
    console.error("[db] persistTeamMember error:", err);
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
    console.error("[db] deleteTeamMemberFromDb error:", err);
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
    };
    const existing = await sc.systemConfig.findUnique({ where: { id: 1 } });
    if (existing) {
      const { id: _omit, ...rest } = data;
      await sc.systemConfig.update({ where: { id: 1 }, data: rest });
    } else {
      await sc.systemConfig.create({ data });
    }
  } catch (err) {
    console.error("[db] persistSystemConfig error:", err);
  }
}
