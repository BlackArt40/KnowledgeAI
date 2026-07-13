import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ensureHydrated } from "@/lib/db/hydrate";
import { rateLimit } from "@/lib/security/rate-limit";
import { startCleanupTimer } from "@/lib/storage/cleanup";

// ---------------------------------------------------------------------------
// Rate Limiting Proxy
//
// Protects /api/* routes from abuse. Uses distributed rate limiter:
//   - REDIS_URL set    -> Redis sliding window (multi-instance)
//   - REDIS_URL absent -> in-memory sliding window (single-instance, demo)
//
// Skipped for SSE streams, webhooks, and frequently-polled endpoints.
// ---------------------------------------------------------------------------

const LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || "200", 10);

// Skip rate limiting for these (SSE streams, webhooks, high-frequency polls)
const SKIP_PATHS = [
  "/api/chat",        // SSE stream
  "/api/agent/run",   // SSE stream
  "/api/billing/webhook",
  "/api/notifications",  // polled every 30s
  "/api/auth/me",        // called on every page load
];

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

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";

  // Distributed rate limit check (Redis or memory fallback)
  const result = await rateLimit(ip, LIMIT);

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试", retryAfter },
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

  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Limit", String(result.limit));
  res.headers.set("X-RateLimit-Remaining", String(result.remaining));
  res.headers.set("X-RateLimit-Reset", String(result.resetAt));
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
