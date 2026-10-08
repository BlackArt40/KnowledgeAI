// ---------------------------------------------------------------------------
// F5 / S4: Shared (cross-instance) JWT jti revocation store.
//
// The local blacklist in session.ts is a globalThis Map - it only knows the
// revocations this process performed. With more than one app instance a
// session revoked on instance A stayed valid on instance B (the 7-day token
// was rejected only where the revoke happened).
//
// This module mirrors revocations to Redis when REDIS_URL is configured:
//   - revokeJti()        -> local Map + SETEX jti-blacklist:<jti> EX 8d
//   - verifyToken()      -> local Map first, then a Redis GET (miss path)
//
// Failure policy mirrors the rate limiter (F9): when Redis is unreachable the
// check degrades to the local Map (same-instance revokes still enforced; a
// cross-instance revoke is missed until Redis recovers) and the degradation
// is counted + surfaced on /api/health/ready as `revocation.degraded`, so
// monitoring can alert. Without REDIS_URL (demo / single-instance) the local
// Map remains authoritative and no Redis traffic happens.
//
// TTL: tokens live 7 days; the Redis key expires after 8 days (an entry older
// than that can never match a live token).
// ---------------------------------------------------------------------------

import { log } from "@/lib/obs/log";

/** Token lifetime is 7 days; keep revocations a day longer. */
const JTI_TTL_SECONDS = 8 * 86400;
const KEY_PREFIX = "jti-blacklist:";
const DEGRADE_LOG_INTERVAL_MS = 60_000;

/** Narrow view of the ioredis surface this module uses (keeps tests fake-able). */
export interface JtiRedisClient {
  set(key: string, value: string, exFlag: "EX", seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

let client: JtiRedisClient | null = null;

async function getClient(): Promise<JtiRedisClient | null> {
  if (client) return client;
  if (!process.env.REDIS_URL) return null;

  try {
    // Dynamic import ioredis (same pattern as rate-limit.ts - the app runs
    // without it in demo mode).
    const Redis = (await import("ioredis")).default;
    const c = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: (times) => (times < 3 ? Math.min(times * 500, 2000) : null),
    }) as unknown as JtiRedisClient & { on?: (event: string, cb: (err: unknown) => void) => void };
    // A listener keeps an ioredis error event from crashing the process; the
    // failure itself is recorded by the call-site try/catch below.
    c.on?.("error", () => {});
    client = c;
    log.info("[jti] shared revocation store initialized (Redis)");
    return client;
  } catch (err) {
    log.warn({ err }, "[jti] ioredis load failed - keeping the local revocation Map");
    return null;
  }
}

// ── Degradation visibility (mirrors the rate limiter's F9 counters) ────────

interface JtiDegradation {
  fallbacks: number;
  lastFallbackAt: number | null;
  lastError: string | null;
  lastLoggedAt: number;
}

const g = globalThis as unknown as { __KAI_JTI_DEGRADE__?: JtiDegradation };

function degradation(): JtiDegradation {
  if (!g.__KAI_JTI_DEGRADE__) {
    g.__KAI_JTI_DEGRADE__ = { fallbacks: 0, lastFallbackAt: null, lastError: null, lastLoggedAt: 0 };
  }
  return g.__KAI_JTI_DEGRADE__;
}

function markDegraded(err: unknown): void {
  const d = degradation();
  const now = Date.now();
  d.fallbacks += 1;
  d.lastFallbackAt = now;
  d.lastError = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
  if (now - d.lastLoggedAt >= DEGRADE_LOG_INTERVAL_MS) {
    d.lastLoggedAt = now;
    log.warn(
      { err: d.lastError, fallbacks: d.fallbacks },
      "[jti] Redis 不可用 - 撤销黑名单回落本实例内存（跨实例撤销暂不生效）"
    );
  }
}

function markHealthy(): void {
  const d = degradation();
  if (d.lastFallbackAt !== null) {
    log.info({ fallbacks: d.fallbacks }, "[jti] Redis 恢复，撤销黑名单重新跨实例生效");
    d.lastFallbackAt = null;
    d.lastError = null;
  }
}

/** Whether the shared revocation store is degraded to per-instance memory. */
export function jtiStoreDegradation(): {
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

// ── Public API ─────────────────────────────────────────────────────────────

/** Mirror a revocation into the shared store. Fire-and-forget: the local Map
 *  in session.ts is already updated by the caller, so a Redis hiccup never
 *  blocks the revoke path - it only delays cross-instance visibility (and is
 *  recorded as a degradation). */
export function sharedRevokeJti(jti: string): void {
  void (async () => {
    const c = await getClient();
    if (!c) return; // demo / single-instance: local Map is authoritative
    try {
      await c.set(KEY_PREFIX + jti, "1", "EX", JTI_TTL_SECONDS);
      markHealthy();
    } catch (err) {
      markDegraded(err);
    }
  })();
}

/** Check the shared store for a revocation. Returns false when Redis is not
 *  configured or is unreachable (the caller's local Map check still ran). */
export async function sharedIsJtiRevoked(jti: string): Promise<boolean> {
  const c = await getClient();
  if (!c) return false;
  try {
    const v = await c.get(KEY_PREFIX + jti);
    markHealthy();
    return v === "1";
  } catch (err) {
    markDegraded(err);
    return false;
  }
}

// ── Test hooks ─────────────────────────────────────────────────────────────

/** Test-only: inject a fake client (null clears it). */
export function __setJtiRedisForTest(c: JtiRedisClient | null): void {
  client = c;
}

/** Test-only: clear the injected client + degradation counters. */
export function __resetJtiStateForTest(): void {
  client = null;
  g.__KAI_JTI_DEGRADE__ = undefined;
}
