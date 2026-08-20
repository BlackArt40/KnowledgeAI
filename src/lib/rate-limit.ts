// ---------------------------------------------------------------------------
// Distributed Rate Limiter - Redis-backed sliding window with memory fallback.
//
// When REDIS_URL is set: uses Redis EVAL (Lua script) for atomic sliding window.
// Otherwise: falls back to in-memory Map (single-instance, demo mode).
//
// Features:
//   - Sliding window counter (not fixed window)
//   - Tiered rate limiting (P3-3): anonymous IP / user / API key / KB
//   - Integration tier (P7-2): third-party integrations (bots, widget) get
//     their own dimension so one integration can't starve a user's quota
//   - Configurable window + limit
//   - Returns remaining + accurate reset timestamp (earliest entry expiry)
//   - Stats ring buffer + live view for the admin rate-limit dashboard
// ---------------------------------------------------------------------------


import { log } from "@/lib/obs/log";

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || "200", 10);
const ANON_LIMIT = parseInt(process.env.RATE_LIMIT_ANON_PER_MIN || "20", 10);
const KEY_LIMIT = parseInt(process.env.RATE_LIMIT_KEY_PER_MIN || "500", 10);
const KB_LIMIT = parseInt(process.env.RATE_LIMIT_KB_PER_MIN || "60", 10);
const INTEGRATION_LIMIT = parseInt(process.env.RATE_LIMIT_INTEGRATION_PER_MIN || "120", 10);
// P1-2: agent runs spawn expensive multi-step LLM tasks (searcher/analyzer/
// writer). The proxy skips /api/agent/run (SSE), so a dedicated in-route
// quota is the only guard against cost DoS. Deliberately low vs the API tier.
const AGENT_LIMIT = parseInt(process.env.RATE_LIMIT_AGENT_PER_MIN || "10", 10);

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  count: number;
}

/** All tier limits - single source of truth for proxy / routes / admin panel. */
export function getRateLimitLimits() {
  return { base: DEFAULT_LIMIT, anon: ANON_LIMIT, key: KEY_LIMIT, kb: KB_LIMIT, integration: INTEGRATION_LIMIT, agent: AGENT_LIMIT };
}

// ── Memory rate limiter (fallback) ───────────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
  limit: number;
}

const memoryBuckets = new Map<string, Bucket>();
let lastMemoryCleanup = Date.now();

function memoryRateLimit(key: string, limit: number): RateLimitResult {
  // Periodic cleanup
  const now = Date.now();
  if (now - lastMemoryCleanup > 30_000) {
    lastMemoryCleanup = now;
    for (const [k, b] of memoryBuckets) {
      if (b.resetAt < now) memoryBuckets.delete(k);
    }
  }

  let bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS, limit };
    memoryBuckets.set(key, bucket);
  }

  bucket.count++;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    count: bucket.count,
  };
}

// ── Redis rate limiter ───────────────────────────────────────────────────

// Lua script for atomic sliding window rate limiting.
// resetAt = earliest entry score + window, so Retry-After reflects the real
// time until the oldest request slides out of the window (P3-3 acceptance).
const REDIS_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Remove expired entries
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- Count current entries
local count = redis.call('ZCARD', key)

-- Earliest entry expiry = accurate resetAt
local first = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local resetAt = now + window
if first[2] then resetAt = tonumber(first[2]) + window end

if count < limit then
  -- Add current request
  redis.call('ZADD', key, now, now .. '-' .. math.random())
  redis.call('PEXPIRE', key, window)
  return {1, limit, limit - count - 1, resetAt, count + 1}
else
  return {0, limit, 0, resetAt, count}
end
`;

let redisClient: unknown = null;

async function getRedisClient(): Promise<unknown | null> {
  if (redisClient) return redisClient;
  if (!process.env.REDIS_URL) return null;

  try {
    // Dynamic import ioredis (not installed in demo mode)
    const Redis = (await import("ioredis")).default;
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    log.info("[ratelimit] Redis client initialized");
    return redisClient;
  } catch {
    log.warn("[ratelimit] ioredis not installed - using memory rate limiter");
    return null;
  }
}

async function redisRateLimit(key: string, limit: number): Promise<RateLimitResult | null> {
  const client = (await getRedisClient()) as {
    eval: (script: string, keys: number, ...args: (string | number)[]) => Promise<number[]>;
  } | null;
  if (!client) return null;

  try {
    const now = Date.now();
    const result = await client.eval(
      REDIS_SCRIPT,
      1,
      `rl:${key}`,
      limit,
      WINDOW_MS,
      now
    );
    return {
      allowed: result[0] === 1,
      limit: result[1],
      remaining: result[2],
      resetAt: result[3],
      count: result[4],
    };
  } catch {
    // Redis error -> fall back to memory
    return null;
  }
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
  if (key.startsWith("apikey:")) return "apikey";
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
 * memory buckets and Redis results both funnel through recordStat().
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
 * Uses Redis when available, falls back to memory.
 */
export async function rateLimit(
  key: string,
  limit: number = DEFAULT_LIMIT
): Promise<RateLimitResult> {
  // Try Redis first
  const redisResult = await redisRateLimit(key, limit);
  const result = redisResult ?? memoryRateLimit(key, limit);
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

/** Standard 429 response for route-level limits (same shape as the proxy's). */
export function rateLimitResponse(result: RateLimitResult, dimension: string): Response {
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
