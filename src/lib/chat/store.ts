import type { Citation } from "@/lib/rag/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  createdAt: number;
}

export interface Conversation {
  id: string;
  kbId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

type Store = { conversations: Map<string, Conversation> };
const g = globalThis as unknown as { __KAI_CHAT_STORE__?: Store };
function store(): Store {
  if (!g.__KAI_CHAT_STORE__) g.__KAI_CHAT_STORE__ = { conversations: new Map() };
  return g.__KAI_CHAT_STORE__;
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 24 ? t.slice(0, 24) + "…" : t || "新会话";
}

export function listConversations(kbId: string): Conversation[] {
  return Array.from(store().conversations.values())
    .filter((c) => c.kbId === kbId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** All conversations across every KB, most-recent first. */
export function listAllConversations(limit?: number): Conversation[] {
  const all = Array.from(store().conversations.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
  return limit ? all.slice(0, limit) : all;
}

export function getConversation(id: string): Conversation | undefined {
  return store().conversations.get(id);
}

export function createConversation(kbId: string, title = "新会话"): Conversation {
  const conv: Conversation = {
    id: uid("conv"),
    kbId,
    title,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store().conversations.set(conv.id, conv);
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
  return message;
}

export function deleteConversation(id: string): boolean {
  return store().conversations.delete(id);
}
