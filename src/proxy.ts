import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Rate Limiting Proxy
//
// Protects /api/* routes from abuse. Uses in-memory sliding window per IP.
// 🔌 Production: replace with Redis/Upstash rate limiter for multi-instance.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000; // 1 minute
const LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || "200", 10);

// Skip rate limiting for these (SSE streams, webhooks)
const SKIP_PATHS = [
  "/api/chat",        // SSE stream
  "/api/agent/run",   // SSE stream
  "/api/billing/webhook",
  "/api/notifications",  // polled every 30s
  "/api/auth/me",        // called on every page load
];

interface Bucket {
  count: number;
  resetAt: number;
}

// In-memory store (per-instance; use Redis in production)
const buckets = new Map<string, Bucket>();

// Clean expired entries periodically
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 30_000) return;
  lastCleanup = now;
  for (const [key, b] of buckets) {
    if (b.resetAt < now) buckets.delete(key);
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only rate-limit API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Skip SSE streams and webhooks
  if (SKIP_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  cleanup();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";
  const key = `rl:${ip}`;
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }

  bucket.count++;

  if (bucket.count > LIMIT) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试", retryAfter },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(LIMIT),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(bucket.resetAt),
        },
      }
    );
  }

  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Limit", String(LIMIT));
  res.headers.set("X-RateLimit-Remaining", String(Math.max(0, LIMIT - bucket.count)));
  res.headers.set("X-RateLimit-Reset", String(bucket.resetAt));
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
