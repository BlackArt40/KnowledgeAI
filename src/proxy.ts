import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ensureHydrated } from "@/lib/db/hydrate";
import { rateLimit, getRateLimitLimits } from "@/lib/security/rate-limit";
import { validateApiKey } from "@/lib/apikeys/store";
import { verifyToken } from "@/lib/auth/session";
import { startCleanupTimer } from "@/lib/storage/cleanup";

// ---------------------------------------------------------------------------
// Rate Limiting Proxy
//
// Protects /api/* routes from abuse. Uses distributed rate limiter:
//   - REDIS_URL set    -> Redis sliding window (multi-instance)
//   - REDIS_URL absent -> in-memory sliding window (single-instance, demo)
//
// P3-3 tiered rate limiting - one dimension per request:
//   - anonymous (no/invalid credentials)  -> ip:<ip>       @ anon limit
//   - authenticated (JWT cookie/Bearer)   -> user:<userId> @ base limit
//   - API key (Bearer kai_sk_...)         -> apikey:<keyId> @ key limit
//   - per-KB tier is applied in route handlers (kbId lives in body/path,
//     which the proxy can't see) - see /api/chat and /api/knowledge-base/[id].
//
// Skipped for SSE streams, webhooks, and frequently-polled endpoints.
// ---------------------------------------------------------------------------

// Skip rate limiting for these (SSE streams, webhooks, high-frequency polls)
const SKIP_PATHS = [
  "/api/chat",        // SSE stream (user + KB tiers enforced in the route)
  "/api/agent/run",   // SSE stream
  "/api/billing/webhook",
  "/api/notifications",  // polled every 30s
  "/api/auth/me",        // called on every page load
];

interface Tier {
  key: string;
  limit: number;
  dimension: string;
}

// Resolve the rate-limit tier for a request. JWT verification is pure
// Web Crypto (no store dependency); API key lookup may miss before the
// first hydration, in which case the request is treated as anonymous.
async function tierOf(req: NextRequest): Promise<Tier> {
  const limits = getRateLimitLimits();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";

  const cookieToken = req.headers.get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("kai-token="))
    ?.split("=")[1];
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (bearerToken && bearerToken.startsWith("kai_sk_")) {
    const apiKey = validateApiKey(bearerToken);
    if (apiKey) return { key: `apikey:${apiKey.id}`, limit: limits.key, dimension: "apikey" };
  }

  const token = cookieToken || bearerToken;
  if (token) {
    // verifyToken rejects tokens with a `purpose` field (2FA pre-auth tokens).
    const payload = await verifyToken(token);
    if (payload) return { key: `user:${payload.id}`, limit: limits.base, dimension: "user" };
    // Expired/invalid token -> fall through to anonymous (routes return 401).
  }

  return { key: `ip:${ip}`, limit: limits.anon, dimension: "ip" };
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Start periodic cleanup timer (idempotent, auto-starts on first request)
  startCleanupTimer();

  // Hydrate in-memory stores from DB on first API request (fire-and-forget).
  if (!pathname.startsWith("/_next")) {
    void ensureHydrated();
  }

  // Only rate-limit API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Skip SSE streams and webhooks
  if (SKIP_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const tier = await tierOf(req);
  const result = await rateLimit(tier.key, tier.limit);

  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试", retryAfter, dimension: tier.dimension },
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

  // No X-RateLimit-* headers on allowed responses: Next.js merges proxy
  // headers onto the route's final response, which would override the accurate
  // per-dimension headers set by route-level 429s (rateLimitResponse). 429s
  // returned by THIS proxy still carry the full X-RateLimit-* set.
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
