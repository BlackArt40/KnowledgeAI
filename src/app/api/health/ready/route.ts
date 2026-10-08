import { withApiTrace } from "@/lib/obs/trace";
import { checkReadiness, alertOnReadiness, readinessState } from "@/lib/health/readiness";
import { rateLimitDegradation } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// GET /api/health/ready - readiness probe (P6-4).
// Runs DB / Redis / LLM connectivity checks in parallel and reports the
// aggregate: 200 "ok" when nothing is degraded (unconfigured deps in demo
// mode count as "skipped", which is a valid running state); 503 "degraded"
// when any configured dependency is unreachable. Drives the alert state
// machine (ok->degraded / recovery notifications, 10-min re-alert dedupe).
//
// F9: also reports the rate limiter's own view of Redis. The `redis` check
// above can pass while individual EVALs fail, in which case the limiter has
// silently fallen back to per-instance memory buckets - `rateLimitDegraded`
// makes that observable. It is additive (does NOT flip the aggregate status),
// so a degraded limiter is visible without taking the pod out of rotation.
export async function GET(req: Request) {
  return withApiTrace(req, "api /api/health/ready", async () => {
    const checks = await checkReadiness();
    alertOnReadiness(checks);
    const degraded = checks.filter((c) => c.status === "degraded").map((c) => c.name);
    const s = readinessState();
    const rateLimit = rateLimitDegradation();
    return Response.json(
      {
        status: degraded.length > 0 ? "degraded" : "ok",
        checks,
        degraded,
        degradedSince: degraded.length > 0 ? s.degradedSince : null,
        rateLimit,
        rateLimitDegraded: rateLimit.degraded,
        ts: Date.now(),
      },
      { status: degraded.length > 0 ? 503 : 200 }
    );
  });
}
