// ---------------------------------------------------------------------------
// Persistence - write-through layer that syncs in-memory store mutations
// to PostgreSQL.
//
// Each function is a fire-and-forget async operation:
//   - If DB is enabled: writes to Prisma (errors logged, not thrown)
//   - If DB is not configured: no-op
//
// The in-memory store remains the source of truth for reads (ADR-0001). The DB
// is the recovery copy that survives restarts; multi-instance shared reads still
// need a separate evolution per that ADR.
// ---------------------------------------------------------------------------


import { getDb, isDbEnabled } from "../prisma";

import { log } from "@/lib/obs/log";

/**
 * Best-effort persistence helper. Deletes are idempotent, so a P2025 ("row not
 * found") is expected and ignored; every other failure is logged. Previously
 * these paths used `.catch((err) => bestEffort(err))`, which silently diverged memory from DB.
 */
import { bestEffort, withFkRetry } from "./core";

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
