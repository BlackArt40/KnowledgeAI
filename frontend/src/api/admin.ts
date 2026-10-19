// 管理后台 API（V5，契约与 /api/admin* 冻结一致）。概览/用户/KB/配置类型
// 单源复用 src/lib/admin/types（纯 TS）；速率限制 / Provider / 审计事件类型
// 在此声明同构镜像（src/lib/{rate-limit,config,security/audit} 是服务端模块，
// 前端只消费其 JSON 形状，不 import 其实现）。
import { request } from "./client";
import type { AdminOverview, AdminUser, KbMonitor, SystemConfig } from "@shared/admin/types";

export type { AdminOverview, AdminUser, KbMonitor, SystemConfig, SystemStats } from "@shared/admin/types";

export interface RateLimitStat {
  kind: "ip" | "user" | "apikey" | "kb" | "integration" | "agent" | "other";
  key: string;
  count: number;
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface RateLimitDashboard {
  mode: "memory" | "redis";
  limits: { base: number; anon: number; key: number; kb: number };
  live: RateLimitStat[];
  recent: RateLimitStat[];
}

export interface ProviderStatus {
  id: string;
  label: string;
  enabled: boolean;
  detail: string;
}

export interface AuditEventLite {
  id: string;
  createdAt: number;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export interface AuditResponse {
  audit: AuditEventLite[];
  total: number;
  chainValid: boolean;
}

export interface AdminConfigResponse extends SystemConfig {
  providers?: ProviderStatus[];
}

export async function fetchOverview(): Promise<AdminOverview> {
  return request<AdminOverview>("/api/admin");
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const d = await request<{ users?: AdminUser[] }>("/api/admin/users");
  return d?.users ?? [];
}

export async function fetchAdminKbs(): Promise<KbMonitor[]> {
  const d = await request<{ kbs?: KbMonitor[] }>("/api/admin/kbs");
  return d?.kbs ?? [];
}

export async function fetchAdminConfig(): Promise<AdminConfigResponse> {
  return request<AdminConfigResponse>("/api/admin/config");
}

export function patchAdminConfig(patch: Partial<SystemConfig>): Promise<unknown> {
  return request("/api/admin/config", { method: "PATCH", body: patch });
}

export function setUserStatus(id: string, status: "active" | "banned"): Promise<unknown> {
  return request(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } });
}

export async function fetchRatelimit(): Promise<RateLimitDashboard> {
  return request<RateLimitDashboard>("/api/admin/ratelimit");
}

export async function fetchAudit(action?: string, actor?: string): Promise<AuditResponse> {
  const qs = new URLSearchParams();
  if (action) qs.set("action", action);
  if (actor) qs.set("actor", actor);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<AuditResponse>(`/api/admin/audit${suffix}`);
}

// ── 可观测性（/admin/monitoring，P6-1 契约）─────────────────────────────
export interface QueueSnapshot {
  mode: "memory" | "redis";
  available: boolean;
  capturedAt: number;
  queues: {
    name: string;
    concurrency: number;
    counts: { waiting: number; active: number; delayed: number; completed: number; failed: number };
  }[];
  error?: string;
}

export interface MonitoringData {
  startedAt: number;
  uptimeMs: number;
  requests: {
    total: number;
    errors: number;
    errorRate: number;
    perMinute: { ts: number; count: number; errors: number }[];
    latency: { count: number; avgMs: number | null; p50: number | null; p95: number | null; p99: number | null; maxMs: number | null };
  };
  rag: { calls: number; errors: number; latency: { avgMs: number | null; p95: number | null } };
  llm: {
    calls: number;
    errors: number;
    latency: { avgMs: number | null; p95: number | null };
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    byModel: { model: string; calls: number; errors: number; tokens: number; costUsd: number; avgMs: number | null }[];
  };
  doc: { calls: number; ok: number; failed: number; avgMs: number | null };
  agent: { runs: number; ok: number; failed: number; avgMs: number | null };
  queue: QueueSnapshot;
  traces: { traceId: string; name: string; status: string; start: number; durationMs: number }[];
  errors: { id: string; message: string; source: string; createdAt: number }[];
}

export interface TraceSpan {
  spanId: string;
  name: string;
  kind: string;
  durationMs: number;
  status: string;
  parentId: string | null;
}

export async function fetchMonitoring(): Promise<MonitoringData | null> {
  // 403（非管理员）等失败返回 null——看板只读，保留上一份快照
  try {
    return await request<MonitoringData>("/api/admin/monitoring");
  } catch {
    return null;
  }
}

export async function fetchTrace(traceId: string): Promise<TraceSpan[]> {
  const d = await request<{ trace?: { spans?: TraceSpan[] } }>(
    `/api/admin/monitoring/traces?id=${encodeURIComponent(traceId)}`
  );
  return d?.trace?.spans ?? [];
}
