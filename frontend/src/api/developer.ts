// 开发者门户 API（V5，契约与 /api/v1/webhooks、/api/v1/integrations/*、
// /api/api-keys/logs 冻结一致）。
import { request } from "./client";

export interface WebhookSub {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: number;
  lastDeliveryAt: number | null;
  failures: number;
  lastError: string | null;
}

export interface Delivery {
  id: string;
  subscriptionId: string;
  event: string;
  status: number | string;
  ts: number;
  latencyMs: number;
  detail?: string;
}

export interface CallLog {
  id: string;
  keyId: string;
  endpoint: string;
  method: string;
  status: number;
  ts: number;
  latencyMs: number;
}

export async function fetchWebhooks(): Promise<{ webhooks: WebhookSub[]; deliveries: Delivery[] }> {
  const d = await request<{ webhooks?: WebhookSub[]; deliveries?: Delivery[] }>("/api/v1/webhooks");
  return { webhooks: d?.webhooks ?? [], deliveries: d?.deliveries ?? [] };
}

export function createWebhook(body: { name: string; url: string; secret: string; events: string[] }): Promise<unknown> {
  return request("/api/v1/webhooks", { method: "POST", body });
}

export function patchWebhook(id: string, body: Record<string, unknown>): Promise<unknown> {
  return request(`/api/v1/webhooks/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

export function deleteWebhook(id: string): Promise<unknown> {
  return request(`/api/v1/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function testWebhook(id: string): Promise<unknown> {
  return request(`/api/v1/webhooks/${encodeURIComponent(id)}/test`, { method: "POST" });
}

export async function fetchCallLogs(): Promise<CallLog[]> {
  const d = await request<{ logs?: CallLog[] }>("/api/api-keys/logs");
  return d?.logs ?? [];
}

// ── 集成（P7-2）：群机器人 / Notion·Confluence 同步 ─────────────────────
export interface BotBinding {
  id: string;
  name: string;
  platform: string;
  kbId: string;
  kbName?: string;
  active: boolean;
  calls: number;
  createdAt: number;
}

export async function fetchBots(): Promise<BotBinding[]> {
  const d = await request<{ bots?: BotBinding[] }>("/api/v1/integrations/bot");
  return d?.bots ?? [];
}

export function createBot(body: { name: string; platform: string; kbId: string }): Promise<{ bot: { token: string; id: string } }> {
  return request("/api/v1/integrations/bot", { method: "POST", body });
}

export function patchBot(id: string, body: Record<string, unknown>): Promise<unknown> {
  return request(`/api/v1/integrations/bot/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

export function deleteBot(id: string): Promise<unknown> {
  return request(`/api/v1/integrations/bot/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface SyncResult {
  source: "notion" | "confluence";
  imported?: number;
  skipped?: number;
  failed?: number;
}

export function runSync(
  source: "notion" | "confluence",
  body: { kbId: string; databaseId?: string; spaceKey?: string }
): Promise<SyncResult> {
  return request(`/api/v1/integrations/sync/${source}`, { method: "POST", body });
}
