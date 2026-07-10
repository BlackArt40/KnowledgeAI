// ---------------------------------------------------------------------------
// Distributed Rate Limiter - Redis-backed sliding window with memory fallback.
//
// When REDIS_URL is set: uses Redis EVAL (Lua script) for atomic sliding window.
// Otherwise: falls back to in-memory Map (single-instance, demo mode).
//
// Features:
//   - Sliding window counter (not fixed window)
//   - Per-IP + per-user rate limiting
//   - Configurable window + limit
//   - Returns remaining + reset timestamp
// ---------------------------------------------------------------------------


const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || "200", 10);

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

// ── Memory rate limiter (fallback) ───────────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
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
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    memoryBuckets.set(key, bucket);
  }

  bucket.count++;
  const allowed = bucket.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

// ── Redis rate limiter ───────────────────────────────────────────────────

// Lua script for atomic sliding window rate limiting
const REDIS_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Remove expired entries
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- Count current entries
local count = redis.call('ZCARD', key)

if count < limit then
  -- Add current request
  redis.call('ZADD', key, now, now .. '-' .. math.random())
  redis.call('PEXPIRE', key, window)
  return {1, limit, limit - count - 1, now + window}
else
  return {0, limit, 0, now + window}
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
    console.log("[ratelimit] Redis client initialized");
    return redisClient;
  } catch {
    console.warn("[ratelimit] ioredis not installed - using memory rate limiter");
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
    };
  } catch {
    // Redis error -> fall back to memory
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Check rate limit for a key (IP or user ID).
 * Uses Redis when available, falls back to memory.
 */
export async function rateLimit(
  key: string,
  limit: number = DEFAULT_LIMIT
): Promise<RateLimitResult> {
  // Try Redis first
  const redisResult = await redisRateLimit(key, limit);
  if (redisResult) return redisResult;

  // Fall back to memory
  return memoryRateLimit(key, limit);
}

/** Whether Redis-backed rate limiting is active. */
export function isDistributedRateLimit(): boolean {
  return !!process.env.REDIS_URL;
}
