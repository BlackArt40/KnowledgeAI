import type { Citation } from "@/lib/rag/types";
import { persistConversation, persistMessage, persistMessageFeedback, deleteConversationFromDb } from "@/lib/db/persist";
import { uid } from "@/lib/ids";
import { publish } from "@/lib/realtime/bus";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  createdAt: number;
  /** P5-3: like/dislike feedback on an assistant answer, used to down-weight
   *  its cited documents in later retrievals (negative-feedback loop). */
  feedback?: "up" | "down";
  feedbackNote?: string;
  feedbackAt?: number;
}

export interface Conversation {
  id: string;
  kbId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  userId?: string;
  /** P4-1: when true, the conversation is visible to team members (shared
   *  collaborative Q&A view) and new messages are broadcast on `conv:<id>`. */
  shared?: boolean;
  /** P4-3: the workspace (tenant) this conversation belongs to. */
  workspaceId: string;
  /** P5-3: archived conversations are hidden from the default list
   *  (they can be restored via ?archived=1). */
  archived?: boolean;
  /** P5-3: user-assigned tags for grouping / filtering conversations. */
  tags?: string[];
}

type Store = { conversations: Map<string, Conversation> };
const g = globalThis as unknown as { __KAI_CHAT_STORE__?: Store };
function store(): Store {
  if (!g.__KAI_CHAT_STORE__) g.__KAI_CHAT_STORE__ = { conversations: new Map() };
  return g.__KAI_CHAT_STORE__;
}

function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 24 ? t.slice(0, 24) + "…" : t || "新会话";
}

export function listConversations(kbId: string, userId?: string): Conversation[] {
  return Array.from(store().conversations.values())
    .filter((c) => c.kbId === kbId && (!userId || c.userId === userId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** All conversations across every KB, most-recent first.
 *  Pass userId to scope to a single user (per-user isolation). */
export function listAllConversations(limit?: number, userId?: string): Conversation[] {
  let all = Array.from(store().conversations.values());
  if (userId) all = all.filter((c) => c.userId === userId);
  all.sort((a, b) => b.updatedAt - a.updatedAt);
  return limit ? all.slice(0, limit) : all;
}

export function getConversation(id: string): Conversation | undefined {
  return store().conversations.get(id);
}

export function createConversation(
  kbId: string,
  title = "新会话",
  userId?: string,
  workspaceId: string = "ws_default"
): Conversation {
  const conv: Conversation = {
    id: uid("conv"),
    kbId,
    title,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userId,
    workspaceId,
  };
  store().conversations.set(conv.id, conv);
  void persistConversation(conv);
  return conv;
}

export function addMessage(
  convId: string,
  msg: Omit<ChatMessage, "id" | "createdAt">
): ChatMessage | undefined {
  const conv = store().conversations.get(convId);
  if (!conv) return undefined;
  const message: ChatMessage = { ...msg, id: uid("msg"), createdAt: Date.now() };
  conv.messages.push(message);
  conv.updatedAt = Date.now();
  if (msg.role === "user" && conv.messages.filter((m) => m.role === "user").length === 1) {
    conv.title = deriveTitle(msg.content);
  }
  store().conversations.set(convId, conv);
  // L-5: persist this message individually (upsert by id) so concurrent
  // addMessage calls can't drop each other's message. The conversation row
  // (title/updatedAt/shared/etc.) is still upserted by persistConversation.
  void persistMessage(convId, message);
  void persistConversation(conv);
  // P4-1: broadcast new messages so team members viewing a shared
  // conversation see it live (listeners only exist while a stream is open).
  if (conv.shared) {
    publish(`conv:${convId}`, {
      type: "message",
      conversationId: convId,
      message: { id: message.id, role: message.role, content: message.content, citations: message.citations, createdAt: message.createdAt },
    });
  }
  return message;
}

/** Toggle team-sharing for a conversation (P4-1). */
export function setConversationShared(id: string, shared: boolean): Conversation | undefined {
  const conv = store().conversations.get(id);
  if (!conv) return undefined;
  conv.shared = shared;
  store().conversations.set(id, conv);
  void persistConversation(conv);
  return conv;
}

/** Archive / restore a conversation (P5-3). */
export function setConversationArchived(id: string, archived: boolean): Conversation | undefined {
  const conv = store().conversations.get(id);
  if (!conv) return undefined;
  conv.archived = archived;
  store().conversations.set(id, conv);
  void persistConversation(conv);
  return conv;
}

/** Replace a conversation's tag list (P5-3). */
export function setConversationTags(id: string, tags: string[]): Conversation | undefined {
  const conv = store().conversations.get(id);
  if (!conv) return undefined;
  conv.tags = tags.filter((t) => t.trim()).map((t) => t.trim()).slice(0, 10);
  store().conversations.set(id, conv);
  void persistConversation(conv);
  return conv;
}

/** Record or clear like/dislike feedback (with optional note) on a message
 *  (P5-3). `feedback=null` clears it. Updating a single message bypasses
 *  persistConversation's last-message-only write so historical answers keep
 *  their feedback across restarts. */
export function setMessageFeedback(
  convId: string,
  messageId: string,
  feedback: "up" | "down" | null,
  note?: string
): ChatMessage | undefined {
  const conv = store().conversations.get(convId);
  if (!conv) return undefined;
  const msg = conv.messages.find((m) => m.id === messageId);
  if (!msg || msg.role !== "assistant") return undefined;
  if (feedback === null) {
    delete msg.feedback;
    delete msg.feedbackNote;
    delete msg.feedbackAt;
  } else {
    msg.feedback = feedback;
    if (note !== undefined) msg.feedbackNote = note || undefined;
    msg.feedbackAt = Date.now();
  }
  conv.updatedAt = Date.now();
  store().conversations.set(convId, conv);
  void persistMessageFeedback(convId, msg);
  return msg;
}

/** All messages that carry feedback, newest first (P5-3; e.g. admin / RAG
 *  optimization review). */
export function listFeedbackMessages(): { conversationId: string; message: ChatMessage }[] {
  const out: { conversationId: string; message: ChatMessage }[] = [];
  for (const conv of store().conversations.values()) {
    for (const m of conv.messages) {
      if (m.feedback) out.push({ conversationId: conv.id, message: m });
    }
  }
  return out.sort((a, b) => (b.message.feedbackAt ?? 0) - (a.message.feedbackAt ?? 0));
}

/** Remove the trailing assistant message (P5-3 regenerate): the replaced
 *  answer must not stay in the conversation history for the new generation. */
export function popLastAssistantMessage(convId: string): ChatMessage | undefined {
  const conv = store().conversations.get(convId);
  if (!conv) return undefined;
  const removed = conv.messages.pop();
  if (!removed || removed.role !== "assistant") {
    if (removed) conv.messages.push(removed); // not an assistant message - restore
    return undefined;
  }
  conv.updatedAt = Date.now();
  store().conversations.set(convId, conv);
  void persistConversation(conv);
  return removed;
}

/** Team-shared conversations across all KBs (collaborative Q&A view). */
export function listSharedConversations(): Conversation[] {
  return Array.from(store().conversations.values())
    .filter((c) => c.shared)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteConversation(id: string): boolean {
  void deleteConversationFromDb(id);
  return store().conversations.delete(id);
}

/** Delete all conversations older than `cutoff` timestamp for a given user.
 *  Used by the data-retention cleanup. Returns the number deleted. */
export function deleteConversationsOlderThan(userId: string, cutoff: number): number {
  const s = store();
  let count = 0;
  for (const [id, conv] of s.conversations) {
    if (conv.userId === userId && conv.updatedAt < cutoff) {
      s.conversations.delete(id);
      count++;
    }
  }
  return count;
}

/** Delete ALL conversations for a user (account deletion). */
export function deleteAllConversations(userId: string): number {
  const s = store();
  let count = 0;
  for (const [id, conv] of s.conversations) {
    if (conv.userId === userId) {
      s.conversations.delete(id);
      count++;
    }
  }
  return count;
}
