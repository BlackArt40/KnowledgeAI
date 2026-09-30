// Tessa test-debt #1 (P32): rate limiter.
// F9 also lives here: a Redis outage must not silently downgrade the limiter
// to per-instance memory buckets without it being observable.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  agentRateLimit,
  emailRateLimit,
  getRateLimitLimits,
  integrationRateLimit,
  kbRateLimit,
  rateLimit,
  rateLimitDegradation,
  rateLimitStats,
} from "./rate-limit";

const g = globalThis as unknown as {
  __KAI_RATE_STATS__?: Map<string, unknown>;
  __KAI_RATE_RECENT__?: unknown[];
  __KAI_RATELIMIT_DEGRADE__?: unknown;
};

beforeEach(() => {
  delete g.__KAI_RATE_STATS__;
  delete g.__KAI_RATE_RECENT__;
  delete g.__KAI_RATELIMIT_DEGRADE__;
  delete process.env.REDIS_URL;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("memory limiter (no REDIS_URL)", () => {
  it("allows up to the limit and blocks the next request", async () => {
    const a = await rateLimit("user:u1", 2);
    const b = await rateLimit("user:u1", 2);
    const c = await rateLimit("user:u1", 2);
    expect([a.allowed, b.allowed, c.allowed]).toEqual([true, true, false]);
    expect(a.remaining).toBe(1);
    expect(b.remaining).toBe(0);
    expect(c.remaining).toBe(0);
    expect(c.count).toBe(3);
  });

  it("counts keys independently", async () => {
    await rateLimit("user:a", 1);
    const other = await rateLimit("user:b", 1);
    expect(other.allowed).toBe(true);
  });

  it("reports a resetAt inside the window", async () => {
    const now = Date.now();
    const r = await rateLimit("ip:1.2.3.4", 5);
    expect(r.resetAt).toBeGreaterThan(now);
    expect(r.resetAt).toBeLessThanOrEqual(now + 60_000);
  });

  it("collects dashboard stats with the right dimension kind", async () => {
    await kbRateLimit("kb_1");
    await agentRateLimit("usr_1");
    await integrationRateLimit("bot_1");
    await emailRateLimit("reset", "a@b.dev");
    const { live } = rateLimitStats();
    const kinds = Object.fromEntries(live.map((s) => [s.key, s.kind]));
    expect(kinds["kb:kb_1"]).toBe("kb");
    expect(kinds["agent:user:usr_1"]).toBe("agent");
    expect(kinds["integration:bot_1"]).toBe("integration");
    expect(kinds["auth-email:reset:a@b.dev"]).toBe("other");
  });
});

describe("degradation surface (F9)", () => {
  it("starts healthy", () => {
    const d = rateLimitDegradation();
    expect(d.degraded).toBe(false);
    expect(d.fallbacks).toBe(0);
    expect(d.lastFallbackAt).toBeNull();
    expect(d.lastError).toBeNull();
  });

  it("does NOT report degradation when Redis is not configured at all", async () => {
    // Demo mode: memory buckets are the intended backend, not a degradation.
    await rateLimit("user:demo", 5);
    expect(rateLimitDegradation().degraded).toBe(false);
    expect(rateLimitDegradation().fallbacks).toBe(0);
  });
});

describe("limit configuration", () => {
  it("exposes the documented tier ordering (anon < kb < user < key)", () => {
    const l = getRateLimitLimits();
    expect(l.anon).toBeLessThan(l.kb);
    expect(l.kb).toBeLessThan(l.base);
    expect(l.base).toBeLessThan(l.key);
  });

  it("reads tiers from the environment at module load", async () => {
    vi.stubEnv("RATE_LIMIT_ANON_PER_MIN", "7");
    vi.stubEnv("RATE_LIMIT_KB_PER_MIN", "11");
    vi.stubEnv("RATE_LIMIT_AUTH_EMAIL_PER_MIN", "2");
    vi.resetModules();
    const fresh = await import("./rate-limit");
    const limits = fresh.getRateLimitLimits();
    expect(limits.anon).toBe(7);
    expect(limits.kb).toBe(11);
    expect(limits.authEmail).toBe(2);
  });
});
