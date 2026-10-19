// 聊天 API（V4，契约与 /api/chat* 冻结一致）。SSE 流式（POST /api/chat 与
// 共享会话事件流）在视图内用 @shared/sse 的 consumeSseStream 消费——事件名
// sources/token/done 冻结，勿在此层重命名。
import { request } from "./client";

export interface Citation {
  n: number;
  docId: string;
  docName: string;
  chunkIndex: number;
  snippet: string;
  score: number;
  /** 联网搜索来源携带（web 类型引用可点击） */
  url?: string;
  sourceType?: string;
}

export interface ConvLite {
  id: string;
  title: string;
  updatedAt: number;
  shared?: boolean;
  archived?: boolean;
  tags?: string[];
  [key: string]: unknown;
}

export interface SharedConv {
  id: string;
  title: string;
  updatedAt: number;
  ownerName: string;
}

export interface ConvMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  feedback?: "up" | "down";
  feedbackNote?: string;
  followUps?: string[];
  [key: string]: unknown;
}

/** GET /api/chat/conversations?kbId=&archived=1（归档视图需显式传 archived）。 */
export async function fetchConversations(kbId: string, archived?: boolean): Promise<ConvLite[]> {
  const d = await request<{ conversations?: ConvLite[] }>(
    `/api/chat/conversations?kbId=${encodeURIComponent(kbId)}${archived ? "&archived=1" : ""}`
  );
  return d?.conversations ?? [];
}

/** GET /api/chat/conversations/shared —— 团队共享会话（跨知识库）。 */
export async function fetchSharedConversations(): Promise<SharedConv[]> {
  const d = await request<{ conversations?: SharedConv[] }>("/api/chat/conversations/shared");
  return d?.conversations ?? [];
}

/** GET /api/chat/conversations/[id] —— 历史消息（服务端 id 直接作为 serverId）。 */
export async function fetchConversation(id: string): Promise<ConvMessage[]> {
  const d = await request<{ conversation?: { messages?: ConvMessage[] } }>(
    `/api/chat/conversations/${encodeURIComponent(id)}`
  );
  return d?.conversation?.messages ?? [];
}

export function deleteConversation(id: string): Promise<unknown> {
  return request(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** PATCH 归档（archived）/ 标签（tags）/ 共享（shared）。 */
export function patchConversation(id: string, body: Record<string, unknown>): Promise<unknown> {
  return request(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

/** POST 消息反馈。目标必须是服务端消息 id（done 事件的 messageId）；
 *  再次点击同值传 null = 撤销。 */
export function submitFeedback(
  convId: string,
  messageId: string,
  value: "up" | "down" | null,
  note?: string
): Promise<unknown> {
  return request(
    `/api/chat/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(messageId)}/feedback`,
    { method: "POST", body: { value, ...(note ? { note } : {}) } }
  );
}
