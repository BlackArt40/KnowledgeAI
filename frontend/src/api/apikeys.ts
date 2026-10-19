// API 密钥（P1-7 scope 白名单 + P3-4 加密存储）：列表脱敏、创建响应
// 携带一次性明文 secret、PATCH（启停/改名）、DELETE 撤销、logs 调用日志。
import { request } from "./client";

export const SCOPES: { id: string; label: string }[] = [
  { id: "kb:read", label: "知识库读取" },
  { id: "kb:write", label: "知识库写入" },
  { id: "chat:read", label: "问答调用" },
  { id: "agent:run", label: "Agent 调研" },
  { id: "team:read", label: "团队信息" },
  { id: "webhooks:write", label: "Webhook 管理" },
];

export interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt?: number | null;
  enabled?: boolean;
  [key: string]: unknown;
}

export async function fetchKeys(): Promise<ApiKey[]> {
  const d = await request<{ keys?: ApiKey[] }>("/api/api-keys");
  return d?.keys ?? [];
}

export async function createKey(name: string, scopes: string[]): Promise<ApiKey> {
  const d = await request<{ key: ApiKey }>("/api/api-keys", {
    method: "POST",
    body: { name, scopes },
  });
  return d.key;
}

export function patchKey(id: string, body: Record<string, unknown>): Promise<unknown> {
  return request(`/api/api-keys/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

export function revokeKey(id: string): Promise<unknown> {
  return request(`/api/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
}
