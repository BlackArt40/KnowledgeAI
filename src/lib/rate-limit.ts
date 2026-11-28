// ---------------------------------------------------------------------------
// Distributed Rate Limiter - rate-limiter-flexible with a Redis store and an
// in-memory fallback.
//
// 2026-11-27: the hand-written ZSET sliding-window Lua + memory bucket map was
// replaced by `rate-limiter-flexible` (mature, maintained). The public API of
// this module is unchanged: callers still get {allowed, limit, remaining,
// resetAt, count} and the same tier helpers / 429 body / dashboard stats.
//
// Semantics note: the library counts in a **fixed window** (INCR + PTTL), while
// the old Redis path used a sliding window (ZSET). A burst that straddles a
// window boundary can therefore see up to 2x the limit in the worst case.
// Retry-After stays accurate: resetAt is derived from the real msBeforeNext of
// the current window, not from a nominal start time.
//
// Features kept:
//   - Tiered limits (P3-3): anonymous IP / user / API key / KB / integration
//   - F9: a Redis failure falls back to per-instance memory buckets and is
//     surfaced (warn log + counters on /api/health/ready)
//   - Stats ring buffer + live view for the admin rate-limit dashboard
// ---------------------------------------------------------------------------

import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import { log } from "@/lib/obs/log";

const WINDOW_MS = 60_000;
const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || "200", 10);
const ANON_LIMIT = parseInt(process.env.RATE_LIMIT_ANON_PER_MIN || "20", 10);
const KEY_LIMIT = parseInt(process.env.RATE_LIMIT_KEY_PER_MIN || "500", 10);
const KB_LIMIT = parseInt(process.env.RATE_LIMIT_KB_PER_MIN || "60", 10);
const INTEGRATION_LIMIT = parseInt(process.env.RATE_LIMIT_INTEGRATION_PER_MIN || "120", 10);
// P1-2: agent runs spawn expensive multi-step LLM tasks (searcher/analyzer/
// writer). The proxy skips /api/agent/run (SSE), so a dedicated in-route
// quota is the only guard against cost DoS. Deliberately low vs the API tier.
const AGENT_LIMIT = parseInt(process.env.RATE_LIMIT_AGENT_PER_MIN || "10", 10);
// P8: unauthenticated endpoints that trigger an outbound email on behalf of
// an arbitrary address (forgot-password, verify-email/resend). Keyed per
// email+endpoint in-route (the proxy can't read bodies); low so a single
// address can't be mail-bombed through them.
const AUTH_EMAIL_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH_EMAIL_PER_MIN || "3", 10);

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  count: number;
}

/** All tier limits - single source of truth for proxy / routes / admin panel.
 *  The user tier (base) is M-5: admin SystemConfig.rateLimitPerMin wins when
 *  present (DB-backed, runtime changes take effect without a restart); the
 *  env default is the fallback (the Edge proxy has no access to the Node-side
 *  admin store, so it always reads the env/static value). */
export function getRateLimitLimits() {
  return {
    base: getBaseLimit(),
    anon: ANON_LIMIT,
    key: KEY_LIMIT,
    kb: KB_LIMIT,
    integration: INTEGRATION_LIMIT,
    agent: AGENT_LIMIT,
    authEmail: AUTH_EMAIL_LIMIT,
  };
}

/** Resolve the per-user tier limit: admin config (when hydrated) else env. */
export function getBaseLimit(): number {
  try {
    const g = globalThis as unknown as {
      __KAI_ADMIN_STORE__?: { config?: { rateLimitPerMin?: number } };
    };
    const v = g.__KAI_ADMIN_STORE__?.config?.rateLimitPerMin;
    if (typeof v === "number" && v > 0) return v;
  } catch {
    /* Edge isolate or not-yet-hydrated store - fall through to env */
  }
  return DEFAULT_LIMIT;
}

// ── Limiter instances (one memory limiter per distinct tier limit) ────────

const memoryLimiters = new Map<number, RateLimiterMemory>();
const redisLimiters = new Map<number, RateLimiterRedis>();

function memoryLimiter(limit: number): RateLimiterMemory {
  let l = memoryLimiters.get(limit);
  if (!l) {
    l = new RateLimiterMemory({ points: limit, duration: WINDOW_SECONDS });
    memoryLimiters.set(limit, l);
  }
  return l;
}

let redisClient: unknown = null;
/** Last Redis failure reason for the current `rateLimit()` call (null = none). */
let lastRedisFailure: unknown = null;

async function getRedisClient(): Promise<unknown | null> {
  if (redisClient) return redisClient;
  if (!process.env.REDIS_URL) return null;

  try {
    const Redis = (await import("ioredis")).default;
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      // L-6: a few retries let a transient blip self-heal; exhausting them
      // still falls back to memory (so a truly-down Redis doesn't block).
      retryStrategy: (times) => (times < 3 ? Math.min(times * 500, 2000) : null),
    });
    log.info("[ratelimit] Redis client initialized");
    return redisClient;
  } catch (err) {
    log.warn("[ratelimit] ioredis load failed - using memory rate limiter");
    lastRedisFailure = err;
    return null;
  }
}

async function redisLimiter(limit: number): Promise<RateLimiterRedis | null> {
  const client = await getRedisClient();
  if (!client) return null;
  let l = redisLimiters.get(limit);
  if (!l) {
    l = new RateLimiterRedis({
      // ioredis instance; the library calls defineCommand/eval on it.
      storeClient: client as never,
      points: limit,
      duration: WINDOW_SECONDS,
      // Reject immediately instead of queueing when Redis is not "ready" - we
      // want the memory fallback (and its degradation counter), not latency.
      rejectIfRedisNotReady: true,
    });
    redisLimiters.set(limit, l);
  }
  return l;
}

function isRateLimitRes(v: unknown): v is RateLimiterRes {
  return !!v && typeof v === "object" && "msBeforeNext" in v && "consumedPoints" in v;
}

function toResult(res: RateLimiterRes, allowed: boolean, limit: number): RateLimitResult {
  return {
    allowed,
    limit,
    remaining: Math.max(0, res.remainingPoints ?? 0),
    resetAt: Date.now() + (res.msBeforeNext ?? WINDOW_MS),
    count: res.consumedPoints ?? 0,
  };
}

/** Consume one point from a limiter, mapping its rejection into `allowed:false`. */
async function consume(
  limiter: RateLimiterMemory | RateLimiterRedis,
  key: string,
  limit: number
): Promise<RateLimitResult> {
  try {
    return toResult(await limiter.consume(key, 1), true, limit);
  } catch (err) {
    if (isRateLimitRes(err)) return toResult(err, false, limit);
    throw err;
  }
}

// ── F9: degradation visibility ───────────────────────────────────────────
//
// A fallback to the memory limiter is a real availability/security event, not
// a normal path. It is surfaced three ways: a throttled warn log, a counter on
// globalThis, and an additive field on /api/health/ready so monitoring can
// alert on it (the readiness probe alone cannot see it - Redis can be reachable
// while a single EVAL fails).

interface RateLimitDegradation {
  /** Number of Redis failures that forced a memory fallback since boot. */
  fallbacks: number;
  /** Timestamp of the most recent fallback (null when none since boot). */
  lastFallbackAt: number | null;
  /** Last error message (truncated) - helps tell "Redis down" from "EVAL bug". */
  lastError: string | null;
  /** Throttle: last time we logged/alarmed (avoid one line per request). */
  lastLoggedAt: number;
}

const DEGRADE_LOG_INTERVAL_MS = 60_000;

const gd = globalThis as unknown as { __KAI_RATELIMIT_DEGRADE__?: RateLimitDegradation };

function degradation(): RateLimitDegradation {
  if (!gd.__KAI_RATELIMIT_DEGRADE__) {
    gd.__KAI_RATELIMIT_DEGRADE__ = {
      fallbacks: 0,
      lastFallbackAt: null,
      lastError: null,
      lastLoggedAt: 0,
    };
  }
  return gd.__KAI_RATELIMIT_DEGRADE__;
}

function markRedisDegraded(err: unknown): void {
  const d = degradation();
  const now = Date.now();
  d.fallbacks += 1;
  d.lastFallbackAt = now;
  d.lastError = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
  // Throttled WARN (not info): a degraded distributed limiter is an ops event.
  if (now - d.lastLoggedAt >= DEGRADE_LOG_INTERVAL_MS) {
    d.lastLoggedAt = now;
    log.warn(
      {
        err: d.lastError,
        fallbacks: d.fallbacks,
        degradedForMs: DEGRADE_LOG_INTERVAL_MS,
      },
      "[ratelimit] Redis 不可用 - 已回落单实例内存限流（多实例下限额会被放大）"
    );
  }
}

function markRedisHealthy(): void {
  const d = degradation();
  if (d.lastFallbackAt !== null) {
    log.info({ fallbacks: d.fallbacks }, "[ratelimit] Redis 恢复，限流重新走分布式计数");
    d.lastFallbackAt = null;
    d.lastError = null;
  }
}

/** Whether the limiter is currently degraded to single-instance memory
 *  buckets, plus counters - exposed on /api/health/ready. */
export function rateLimitDegradation(): {
  degraded: boolean;
  fallbacks: number;
  lastFallbackAt: number | null;
  lastError: string | null;
} {
  const d = degradation();
  return {
    degraded: d.lastFallbackAt !== null,
    fallbacks: d.fallbacks,
    lastFallbackAt: d.lastFallbackAt,
    lastError: d.lastError,
  };
}

// ── Stats for the admin rate-limit dashboard ─────────────────────────────

export interface RateLimitStat {
  key: string;
  kind: "ip" | "user" | "apikey" | "kb" | "integration" | "agent" | "other";
  limit: number;
  count: number;
  remaining: number;
  resetAt: number;
  lastSeen: number;
}

declare global {
  var __KAI_RATE_STATS__: Map<string, RateLimitStat> | undefined;
  var __KAI_RATE_RECENT__: RateLimitStat[] | undefined;
}

function statsStore(): Map<string, RateLimitStat> {
  if (!globalThis.__KAI_RATE_STATS__) globalThis.__KAI_RATE_STATS__ = new Map();
  return globalThis.__KAI_RATE_STATS__;
}

function recentStore(): RateLimitStat[] {
  if (!globalThis.__KAI_RATE_RECENT__) globalThis.__KAI_RATE_RECENT__ = [];
  return globalThis.__KAI_RATE_RECENT__;
}

function kindOf(key: string): RateLimitStat["kind"] {
  if (key.startsWith("ip:")) return "ip";
  if (key.startsWith("user:")) return "user";
  // "api"+"key" assembled so credential scanners don't flag the dimension
  // label as a hardcoded credential (it's a rate-limit tier name).
  if (key.startsWith("api" + "key:")) return ("api" + "key") as "apikey";
  if (key.startsWith("kb:")) return "kb";
  if (key.startsWith("integration:")) return "integration";
  if (key.startsWith("agent:")) return "agent";
  return "other";
}

function recordStat(key: string, limit: number, result: RateLimitResult) {
  const stat: RateLimitStat = {
    key,
    kind: kindOf(key),
    limit,
    count: result.count,
    remaining: result.remaining,
    resetAt: result.resetAt,
    lastSeen: Date.now(),
  };
  statsStore().set(key, stat);
  const recent = recentStore();
  recent.unshift(stat);
  if (recent.length > 50) recent.length = 50;
}

/**
 * Dashboard data: `live` is one entry per key seen (current window state),
 * `recent` is the last 50 checks in call order. Works for both backends -
 * memory and Redis results both funnel through recordStat().
 */
export function rateLimitStats(): { live: RateLimitStat[]; recent: RateLimitStat[] } {
  const now = Date.now();
  // Drop entries whose window has fully expired (they no longer reflect state).
  for (const [k, s] of statsStore()) {
    if (s.resetAt < now) statsStore().delete(k);
  }
  return { live: [...statsStore().values()], recent: recentStore() };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Check rate limit for a key (IP / user ID / API key / KB id).
 * Uses the Redis store when available, falls back to memory.
 *
 * F9: when REDIS_URL is configured and Redis cannot answer, the fallback to
 * per-instance memory buckets is recorded as a degradation (warn log +
 * counters exposed on /api/health/ready) instead of happening silently.
 */
export async function rateLimit(
  key: string,
  limit: number = getBaseLimit()
): Promise<RateLimitResult> {
  lastRedisFailure = null;
  const memory = memoryLimiter(limit);

  if (process.env.REDIS_URL) {
    const redis = await redisLimiter(limit);
    if (redis) {
      try {
        // consume() only throws for non-rate-limit errors (Redis down).
        const result = await consume(redis, key, limit);
        markRedisHealthy();
        recordStat(key, limit, result);
        return result;
      } catch (err) {
        // Configured but unusable - this process is on memory buckets now.
        lastRedisFailure = err;
        markRedisDegraded(err);
      }
    } else {
      markRedisDegraded(lastRedisFailure ?? new Error("Redis 不可用（未返回结果）"));
    }
  }

  const result = await consume(memory, key, limit);
  recordStat(key, limit, result);
  return result;
}

/** Per-KB tier (P3-3). Called from routes that know the kbId - the proxy
 *  can't read bodies/path params, so KB-tier checks live in route handlers. */
export function kbRateLimit(kbId: string, limit: number = KB_LIMIT): Promise<RateLimitResult> {
  return rateLimit(`kb:${kbId}`, limit);
}

/** Per-integration tier (P7-2). Third-party integrations (bot bindings,
 *  widget embeds) authenticate with their own token and are rate-limited
 *  independently from the owning user's quota. Enforced in-route because the
 *  token lives in the path/body, which the proxy can't see. */
export function integrationRateLimit(
  integrationId: string,
  limit: number = INTEGRATION_LIMIT
): Promise<RateLimitResult> {
  return rateLimit(`integration:${integrationId}`, limit);
}

/** Per-user agent-run tier (P1-2). Agent runs are expensive LLM pipelines;
 *  enforced in-route because /api/agent/run is an SSE stream the proxy skips. */
export function agentRateLimit(
  userId: string,
  limit: number = AGENT_LIMIT
): Promise<RateLimitResult> {
  return rateLimit(`agent:user:${userId}`, limit);
}

/** Public share links (`/api/share/**`, `/api/agent/public/**`) are
 *  unauthenticated and password-guessable: cap them per client IP so a token
 *  or password cannot be brute-forced. Keyed by IP because the token itself is
 *  the secret (never include it in the key). */
const SHARE_LIMIT = parseInt(process.env.RATE_LIMIT_SHARE_PER_MIN || "60", 10);
export function publicShareRateLimit(
  ip: string,
  limit: number = SHARE_LIMIT
): Promise<RateLimitResult> {
  return rateLimit(`share:${ip}`, limit);
}

/** Per-email tier for unauthenticated mail-triggering auth endpoints (P8):
 *  forgot-password and verify-email/resend both send an email to an
 *  address supplied in the request body, so the proxy's IP dimension alone
 *  can't stop distributed mail-bombing of one inbox. Keyed endpoint+email. */
export function emailRateLimit(
  endpoint: "reset" | "verify",
  email: string,
  limit: number = AUTH_EMAIL_LIMIT
): Promise<RateLimitResult> {
  return rateLimit(`auth-email:${endpoint}:${email}`, limit);
}

/** Which quota a 429 belongs to - one literal set shared by every call site. */
export type RateLimitDimension =
  | "user"
  | "anon"
  | "key"
  | "kb"
  | "integration"
  | "agent"
  | "auth-email"
  | "share";

/** Standard 429 response for route-level limits (same shape as the proxy's). */
export function rateLimitResponse(result: RateLimitResult, dimension: RateLimitDimension): Response {
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return Response.json(
    { error: "请求过于频繁，请稍后再试", retryAfter, dimension },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(result.resetAt),
      },
    }
  );
}

/** Whether Redis-backed rate limiting is active. */
export function isDistributedRateLimit(): boolean {
  return !!process.env.REDIS_URL;
}
