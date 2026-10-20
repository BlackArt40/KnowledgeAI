// API 密钥（P1-7 scope 白名单 + P3-4 加密存储）：列表脱敏、创建响应
// 携带一次性明文 secret、PATCH（启停/改名）、DELETE 撤销、logs 调用日志。
import { request } from "./client";

/** labelKey 指向共享语言包，渲染处经 t() 取文案（切 en 时不再残留中文）。 */
export const SCOPES: { id: string; labelKey: string }[] = [
  { id: "kb:read", labelKey: "page.api-keys.s28" },
  { id: "kb:write", labelKey: "page.api-keys.s29" },
  { id: "chat:read", labelKey: "page.api-keys.s30" },
  { id: "agent:run", labelKey: "page.api-keys.s31" },
  { id: "team:read", labelKey: "page.api-keys.s32" },
  { id: "webhooks:write", labelKey: "page.api-keys.s33" },
];

export interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt?: number | null;
  expiresAt?: number | null;
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
