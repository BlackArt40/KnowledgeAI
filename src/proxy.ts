import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ensureHydrated } from "@/lib/db/hydrate";
import { rateLimit, getRateLimitLimits } from "@/lib/security/rate-limit";
import { validateApiKey } from "@/lib/apikeys/store";
import { verifyToken } from "@/lib/auth/session";
import { startCleanupTimer } from "@/lib/storage/cleanup";
import { logEdge } from "@/lib/obs/log-edge";

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
  "/api/chat",        // SSE stream + conversation CRUD (user + KB tiers enforced in routes)
  "/api/agent/run",   // SSE stream
  "/api/billing/webhook",
  "/api/notifications",  // polled every 30s
  "/api/auth/me",        // called on every page load
  "/api/kb",             // P4-1: realtime KB event streams (per-KB tier enforced in the route)
  "/api/team/presence",  // P4-1: presence SSE stream + heartbeat (long-lived)
  "/api/share",          // P4-2: public doc share links (token is the credential)
  "/api/health",         // P6-4: liveness/readiness probes (probed every 5-30s by Docker/K8s)
  "/api/v1/integrations/bot", // P7-2: platform bot callbacks (token auth + integration tier in-route)
  "/api/openapi.json",   // P7-1: public API spec (docs page fetches it; anon tier too low)
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

  // P7-2: CORS for the public API surface. Auth is header-based (Bearer
  // kai_sk_... / JWT), never cookies, so the API is safe to call from any
  // origin - the embedded widget and the Chrome extension are cross-origin
  // clients. Handle preflight + attach headers to the (possibly modified)
  // response below.
  const origin = req.headers.get("origin");
  if (origin) {
    if (req.method === "OPTIONS") {
      return new NextResponse(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }
  }

  // P6-1: trace id - propagate an incoming one or mint a fresh id, and make it
  // visible to the downstream route (request headers) + the client (response
  // header). Route-level `withApiTrace` records the spans + SLIs under it.
  const traceId = req.headers.get("x-trace-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-trace-id", traceId);

  const base = { "x-trace-id": traceId };
  const withCors = origin ? { ...base, ...corsHeaders(origin) } : base;

  // Skip SSE streams and webhooks
  if (SKIP_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next({ request: { headers: requestHeaders }, headers: withCors });
  }

  const tier = await tierOf(req);
  const result = await rateLimit(tier.key, tier.limit);

  // P6-2: one structured request line per rate-limited API call (Edge-safe
  // JSON over console - see log-edge.ts). SSE/webhook/poll paths (SKIP_PATHS)
  // skip this; their route-level http.response lines cover request tracking.
  // requestId == the X-Trace-Id minted/propagated above.
  logEdge.info("http.request", {
    method: req.method,
    path: pathname,
    requestId: traceId,
    dimension: tier.dimension,
    rateLimited: !result.allowed,
    status: result.allowed ? undefined : 429,
  });

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
          "x-trace-id": traceId,
          ...(origin ? corsHeaders(origin) : {}),
        },
      }
    );
  }

  // No X-RateLimit-* headers on allowed responses: Next.js merges proxy
  // headers onto the route's final response, which would override the accurate
  // per-dimension headers set by route-level 429s (rateLimitResponse). 429s
  // returned by THIS proxy still carry the full X-RateLimit-* set.
  return NextResponse.next({ request: { headers: requestHeaders }, headers: withCors });
}

/** P7-2: permissive CORS for the header-auth public API (no cookies involved,
 *  so echoing any origin is safe for the embedded widget / extension). */
function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Trace-Id, X-KAI-Required-Scope",
    "Access-Control-Max-Age": "86400",
  };
}

export const config = {
  matcher: ["/api/:path*"],
};
