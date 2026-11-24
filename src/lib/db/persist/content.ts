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

import { log } from "@/lib/obs/log";

/**
 * Best-effort persistence helper. Deletes are idempotent, so a P2025 ("row not
 * found") is expected and ignored; every other failure is logged. Previously
 * these paths used `.catch((err) => bestEffort(err))`, which silently diverged memory from DB.
 */
import { bestEffort, withFkRetry } from "./core";

export async function persistKb(kb: {
  id: string;
  name: string;
  desc: string;
  ownerId: string;
  /** D1: the owning tenant - persisted so the boundary survives a restart. */
  workspaceId?: string;
  settings: object;
  createdAt: number;
  updatedAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      name: kb.name,
      description: kb.desc,
      ownerId: kb.ownerId,
      // D1: only write the column when the caller knows the tenant - keeps
      // pre-existing call sites (which omitted it) from resetting a row back
      // to the default workspace.
      ...(kb.workspaceId ? { workspaceId: kb.workspaceId } : {}),
      settings: kb.settings,
      updatedAt: new Date(kb.updatedAt),
    };
    await db.knowledgeBase.upsert({
      where: { id: kb.id },
      update: data,
      create: { id: kb.id, ...data, createdAt: new Date(kb.createdAt) },
    });
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
    await db.knowledgeBase.delete({ where: { id: kbId } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteKbFromDb error");
  }
}

/** Prisma FK violation (P2003) - a referenced row does not exist yet. */

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
  /** P4-2: view/edit/private override; undefined = inherit the KB. */
  access?: string;
  /** P3: body-edit counter + last editor. */
  version?: number;
  editedBy?: string;
  uploadedAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  const data = {
    name: doc.name,
    type: doc.type,
    size: doc.size,
    status: doc.status,
    progress: doc.progress,
    chunks: doc.chunks,
    url: doc.url ?? null,
    content: doc.content ?? null,
    access: doc.access ?? null,
    version: doc.version ?? 1,
    editedBy: doc.editedBy ?? null,
    updatedAt: new Date(),
  };
  const write = () =>
    db.kbDocument.upsert({
      where: { id: doc.id },
      update: data,
      create: { id: doc.id, kbId: doc.kbId, ...data, uploadedAt: new Date(doc.uploadedAt) },
    });

  // KB creation persists fire-and-forget, and the upload path can persist the
  // document before that write commits - the FK would reject it (P2003).
  await withFkRetry(write, "[db] persistDoc error");
}

/**
 * 批量持久化文档行（整库重建这类一次性改动 N 篇的场景）。
 *
 * 逐篇 upsert 是 N 次往返；这里包成一个事务，失败整体回滚，也不会出现
 * 「前 50 篇写进去了、后 50 篇没写」的中间态。
 */

export async function persistDocs(
  docs: Array<Parameters<typeof persistDoc>[0]>
): Promise<void> {
  if (!isDbEnabled() || docs.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const row = (doc: Parameters<typeof persistDoc>[0]) => ({
    name: doc.name,
    type: doc.type,
    size: doc.size,
    status: doc.status,
    progress: doc.progress,
    chunks: doc.chunks,
    url: doc.url ?? null,
    content: doc.content ?? null,
    version: doc.version ?? 1,
    editedBy: doc.editedBy ?? null,
    updatedAt: new Date(),
  });
  // 本地 PrismaClient 类型是精简 shim，$transaction 未声明 —— 取到就用事务
  // （整批回滚，不留中间态），取不到退化为并发 upsert
  const raw = db as unknown as {
    $transaction?: (ops: Promise<unknown>[]) => Promise<unknown>;
  };
  const ops = docs.map((doc) => {
    const data = row(doc);
    return db.kbDocument.upsert({
      where: { id: doc.id },
      update: data,
      create: { id: doc.id, kbId: doc.kbId, ...data, uploadedAt: new Date(doc.uploadedAt) },
    }) as unknown as Promise<unknown>;
  });

  try {
    if (raw.$transaction) await raw.$transaction(ops);
    else await Promise.all(ops);
  } catch (err) {
    // 与本模块其他写穿函数一致：失败只记日志，不打断请求路径
    log.error({ err, count: docs.length }, "[db] persistDocs error");
  }
}


/** Delete a document from DB. */

export async function deleteDocFromDb(docId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.kbDocument.delete({ where: { id: docId } }).catch((err) => bestEffort(err));
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
  kbName?: string;
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
  agents?: unknown[];
  maxSteps?: number;
  template?: string;
  workspaceId?: string;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      topic: task.topic,
      kbId: task.kbId ?? null,
      kbName: task.kbName ?? null,
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
      agents: task.agents ?? null,
      maxSteps: task.maxSteps ?? 5,
      template: task.template ?? null,
      workspaceId: task.workspaceId ?? "ws_default",
    };
    await db.agentTask.upsert({
      where: { id: task.id },
      update: data,
      create: { id: task.id, userId: task.userId, ...data, createdAt: new Date(task.createdAt) },
    });
  } catch (err) {
    log.error({ err }, "[db] persistTask error");
  }
}

/** M-8: delete an agent task row (deleteTask() used to only drop the
 *  in-memory entry, so deleted tasks resurrected after a restart). */

export async function deleteAgentTaskFromDb(taskId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.agentTask.delete({ where: { id: taskId } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteAgentTaskFromDb error");
  }
}

/** Delete all tasks for a user (account deletion). */

export async function deleteAgentTasksByUserFromDb(userId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { agentTask: { deleteMany: (o: unknown) => Promise<unknown> } })
      .agentTask.deleteMany({ where: { userId } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteAgentTasksByUserFromDb error");
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
  expiresAt: number | null;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      name: key.name,
      // P2: `sha256$...` for new keys; legacy rows may still hold AES
      // ciphertext or plaintext and keep validating via the old path.
      keyHash: key.secret,
      prefix: key.prefix,
      scopes: key.scopes,
      status: key.status,
      calls: key.calls,
      lastUsed: key.lastUsed ? new Date(key.lastUsed) : null,
      expiresAt: key.expiresAt ? new Date(key.expiresAt) : null,
    };
    await db.apiKey.upsert({
      where: { id: key.id },
      update: data,
      create: { id: key.id, userId: key.userId, ...data, createdAt: new Date(key.createdAt) },
    });
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
    await db.apiKey.delete({ where: { id: keyId } }).catch((err) => bestEffort(err));
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
    // Upsert conversation (atomic - fire-and-forget writers must not race)
    if (!conv.userId) {
      // Rows written as "unknown" are filtered out by listConversations() on
      // hydration, i.e. silently lost. Make the caller bug observable.
      log.warn({ conversationId: conv.id, kbId: conv.kbId }, "[db] persistConversation without userId");
    }
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
    await (db as unknown as { conversation: { upsert: (o: unknown) => Promise<unknown> } })
      .conversation.upsert({
        where: { id: conv.id },
        update: data,
        create: { id: conv.id, ...data, createdAt: new Date(conv.createdAt) },
      });
    // L-5: messages are persisted individually by persistMessage() (called from
    // addMessage) so concurrent Q&A never loses history. The old "write only
    // the last message here" path raced: two concurrent addMessage calls each
    // saw the OTHER's message as messages[last] and wrote that, dropping their
    // own. persistConversation now only upserts the conversation row itself.
  } catch (err) {
    log.error({ err }, "[db] persistConversation error");
  }
}

/** L-5: persist a single message (upsert by id). Called from addMessage so
 *  concurrent Q&A each persist their own message without racing on the
 *  "last message" slot. */

export async function persistMessage(
  convId: string,
  msg: { id: string; role: string; content: string; citations?: unknown; createdAt: number }
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  const messages = (db as unknown as { message: { upsert: (o: unknown) => Promise<unknown> } }).message;
  // A brand-new conversation persists fire-and-forget; the first message can
  // reach the DB first and trip Message_conversationId_fkey (P2003).
  await withFkRetry(
    () =>
      messages.upsert({
        where: { id: msg.id },
        update: {
          conversationId: convId,
          role: msg.role,
          content: msg.content,
          citations: msg.citations ?? null,
          createdAt: new Date(msg.createdAt),
        },
        create: {
          id: msg.id,
          conversationId: convId,
          role: msg.role,
          content: msg.content,
          citations: msg.citations ?? null,
          createdAt: new Date(msg.createdAt),
        },
      }),
    "[db] persistMessage error"
  );
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
  const messages = (db as unknown as { message: { upsert: (o: unknown) => Promise<unknown> } }).message;
  await withFkRetry(
    () =>
      messages.upsert({
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
      }),
    "[db] persistMessageFeedback error"
  );
}

/** Delete a conversation from DB. */

export async function deleteConversationFromDb(convId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { conversation: { delete: (o: unknown) => Promise<unknown> } })
      .conversation.delete({ where: { id: convId } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteConversationFromDb error");
  }
}

/** Delete a user's conversations (all, or only those older than `cutoff`).
 *  Messages are removed by the Conversation -> Message cascade. */

export async function deleteConversationsByUserFromDb(userId: string, cutoff?: number): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const where = cutoff === undefined
      ? { userId }
      : { userId, updatedAt: { lt: new Date(cutoff) } };
    await (db as unknown as { conversation: { deleteMany: (o: unknown) => Promise<unknown> } })
      .conversation.deleteMany({ where }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteConversationsByUserFromDb error");
  }
}

/** Delete a single message from DB (P5-3 regenerate replaces the old answer). */

export async function deleteMessageFromDb(messageId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await (db as unknown as { message: { delete: (o: unknown) => Promise<unknown> } })
      .message.delete({ where: { id: messageId } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteMessageFromDb error");
  }
}

// ── Billing: Subscription + Invoice + Order ──────────────────────────────

/** Persist a subscription to DB. */
