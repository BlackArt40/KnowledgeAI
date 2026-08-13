// ---------------------------------------------------------------------------
// Health checks & readiness probes (P6-4).
//
// Three dependency checks feed the readiness endpoint:
//   - db    -> SELECT 1 via Prisma (skipped in demo mode - no DATABASE_URL)
//   - redis -> ioredis PING (skipped without REDIS_URL)
//   - llm   -> GET {baseUrl}/models (skipped without OPENAI_API_KEY)
//
// Demo mode (no external deps configured) is a valid running state, so
// unconfigured deps report "skipped" and the aggregate stays ready. A
// configured-but-unreachable dependency reports "degraded" and flips the
// aggregate to 503.
//
// Alerting: on the ok->degraded transition (and every RE_ALERT_MS while
// degraded) admins get an in-app notification + a structured error log line
// + an error-ring entry (Sentry-forwarded when SENTRY_DSN is set). Recovery
// sends a single "back to normal" notification. State lives on globalThis so
// dev HMR doesn't reset it.
// ---------------------------------------------------------------------------

import { isDbEnabled, getDb } from "@/lib/db/client";
import { listUsers } from "@/lib/auth/store";
import { notify } from "@/lib/notifications/store";
import { log } from "@/lib/obs/log";
import { reportError } from "@/lib/obs/errors";

export type DepName = "db" | "redis" | "llm";
export type DepStatusValue = "ok" | "degraded" | "skipped";

export interface DepStatus {
  name: DepName;
  status: DepStatusValue;
  detail?: string;
  latencyMs?: number;
}

const DB_TIMEOUT_MS = 3000;
const REDIS_TIMEOUT_MS = 3000;
const LLM_TIMEOUT_MS = 5000;
/** Re-alert interval while the service stays degraded (10 min). */
const RE_ALERT_MS = 10 * 60 * 1000;
const FAILURE_RING_CAP = 50;

export interface HealthFailure {
  ts: number;
  deps: string[];
}

interface HealthState {
  degraded: boolean;
  degradedSince: number | null;
  lastAlertAt: number;
  lastRecoveredAt: number | null;
  failures: HealthFailure[];
}

const g = globalThis as unknown as { __KAI_HEALTH_STATE__?: HealthState };

function state(): HealthState {
  if (!g.__KAI_HEALTH_STATE__) {
    g.__KAI_HEALTH_STATE__ = {
      degraded: false,
      degradedSince: null,
      lastAlertAt: 0,
      lastRecoveredAt: null,
      failures: [],
    };
  }
  return g.__KAI_HEALTH_STATE__;
}

/** Reset the alert state machine (tests / manual recovery). */
export function resetReadinessState(): void {
  delete (globalThis as Record<string, unknown>).__KAI_HEALTH_STATE__;
}

export function readinessState(): HealthState {
  return state();
}

/** Reject after ms (the underlying operation keeps running - fine for probes). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} 检查超时 (${ms}ms)`)), ms);
    }),
  ]);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
}

// ── Per-dependency checks ────────────────────────────────────────────────

/** DB connectivity: real SELECT 1 (getDb() never connects by itself). */
export async function checkDb(): Promise<DepStatus> {
  if (!isDbEnabled()) {
    return { name: "db", status: "skipped", detail: "DATABASE_URL 未配置（演示模式）" };
  }
  const db = await getDb();
  if (!db) return { name: "db", status: "degraded", detail: "Prisma 客户端不可用" };
  const start = Date.now();
  try {
    await withTimeout(db.$queryRaw("SELECT 1"), DB_TIMEOUT_MS, "数据库");
    return { name: "db", status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "db", status: "degraded", detail: errMessage(err) };
  }
}

/** Redis connectivity: fresh ioredis client + PING (existing modules keep
 *  their clients private, so the probe creates its own and disconnects). */
export async function checkRedis(): Promise<DepStatus> {
  const url = process.env.REDIS_URL;
  if (!url) {
    return { name: "redis", status: "skipped", detail: "REDIS_URL 未配置（演示模式）" };
  }
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // no reconnect - a failed probe stays failed
      connectTimeout: REDIS_TIMEOUT_MS,
    });
    try {
      const start = Date.now();
      // ioredis 类型未声明 ping/call（Commander 动态命令），用类型完备的
      // connect()：lazyConnect + connectTimeout 下连接成功即代表 Redis 可达。
      await withTimeout(client.connect(), REDIS_TIMEOUT_MS, "Redis");
      return { name: "redis", status: "ok", latencyMs: Date.now() - start };
    } finally {
      client.disconnect();
    }
  } catch (err) {
    return { name: "redis", status: "degraded", detail: errMessage(err) };
  }
}

/** LLM connectivity: cheap GET {baseUrl}/models (OpenAI-compatible, no tokens
 *  consumed). Reads env directly - per-user model resolution is context-bound
 *  and irrelevant for a readiness probe. */
export async function checkLlm(): Promise<DepStatus> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { name: "llm", status: "skipped", detail: "OPENAI_API_KEY 未配置（演示模式）" };
  }
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    return {
      name: "llm",
      status: res.ok ? "ok" : "degraded",
      detail: res.ok ? undefined : `HTTP ${res.status}`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return { name: "llm", status: "degraded", detail: errMessage(err) };
  }
}

// ── Aggregate + alerting ─────────────────────────────────────────────────

/** Run all dependency checks in parallel. */
export async function checkReadiness(): Promise<DepStatus[]> {
  const [db, redis, llm] = await Promise.all([checkDb(), checkRedis(), checkLlm()]);
  return [db, redis, llm];
}

/** Notify all owner/admin users (in-app notification, channel-respecting). */
function notifyAdmins(title: string, body: string, link = "/admin/monitoring"): number {
  let sent = 0;
  for (const u of listUsers()) {
    if ((u.role === "owner" || u.role === "admin") && u.status === "active") {
      if (notify(u.id, "securityAlert", title, body, link)) sent++;
    }
  }
  return sent;
}

/**
 * Drive the alert state machine from a fresh readiness result:
 *   - ok -> degraded: alert (notify admins + error log + error ring)
 *   - degraded -> ok: recovery notification + info log
 *   - degraded (repeat): re-alert every RE_ALERT_MS
 * Returns true when an alert was emitted on this call.
 */
export function alertOnReadiness(deps: DepStatus[]): boolean {
  const degraded = deps.filter((d) => d.status === "degraded").map((d) => d.name);
  const s = state();
  const now = Date.now();

  if (degraded.length > 0) {
    s.failures.unshift({ ts: now, deps: degraded });
    if (s.failures.length > FAILURE_RING_CAP) s.failures.length = FAILURE_RING_CAP;
  }

  if (degraded.length > 0 && !s.degraded) {
    // Transition ok -> degraded: alert now.
    s.degraded = true;
    s.degradedSince = now;
    s.lastAlertAt = now;
    const names = degraded.join("、");
    const detail = deps.filter((d) => d.status === "degraded").map((d) => `${d.name}: ${d.detail ?? "不可用"}`).join("; ");
    notifyAdmins("服务依赖不可用", `就绪探针检测到 ${names} 异常：${detail}`);
    log.error({ err: new Error(`就绪探针失败: ${detail}`) }, "[health] dependencies degraded");
    reportError(new Error(`就绪探针失败: ${names} (${detail})`), { source: "/api/health/ready", tags: { deps: names } });
    return true;
  }

  if (degraded.length > 0 && s.degraded && now - s.lastAlertAt >= RE_ALERT_MS) {
    // Still degraded - re-alert on the interval (dedupe storms).
    s.lastAlertAt = now;
    notifyAdmins("服务依赖仍不可用", `就绪探针持续检测到 ${degraded.join("、")} 异常（${Math.round((now - (s.degradedSince ?? now)) / 60000)} 分钟）`);
    log.error({ deps: degraded.join(",") }, "[health] dependencies still degraded");
    return true;
  }

  if (degraded.length === 0 && s.degraded) {
    // Recovery.
    s.degraded = false;
    s.lastRecoveredAt = now;
    s.degradedSince = null;
    notifyAdmins("服务依赖已恢复", "就绪探针检测到全部依赖恢复正常");
    log.info("[health] dependencies recovered");
    return true;
  }

  return false;
}
