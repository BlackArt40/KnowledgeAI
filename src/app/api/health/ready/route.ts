import { withApiTrace } from "@/lib/obs/trace";
import { checkReadiness, alertOnReadiness, readinessState } from "@/lib/health/readiness";
import { rateLimitDegradation } from "@/lib/rate-limit";
import { jtiStoreDegradation } from "@/lib/auth/jti-shared";
import { queueBackpressureSnapshot } from "@/lib/queue";
import { getRequestUser } from "@/lib/auth/guard";
import { dbRetrySnapshot } from "@/lib/db/retry";

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
//
// F5: same additive contract for the shared jti revocation store
// (`revocationDegraded`) - while degraded to the per-instance Map a session
// revoked on another instance is not enforced everywhere.
//
// X5/X6: `queueBackpressured` flips when any queue's backlog (waiting +
// delayed) is at QUEUE_MAX_DEPTH - new jobs are being rejected, so alert on
// this before producers start erroring.
export async function GET(req: Request) {
  return withApiTrace(req, "api /api/health/ready", async () => {
    const checks = await checkReadiness();
    alertOnReadiness(checks);
    // P2: anonymous probes get status/latency only. `detail` can contain
    // internal hostnames and driver errors; expose it to owner/admin only.
    const verbose = new URL(req.url).searchParams.get("verbose") === "1";
    const u = verbose ? await getRequestUser(req) : null;
    const canSeeDetail = u !== null && ["owner", "admin"].includes(u.role);
    const safeChecks = canSeeDetail
      ? checks
      : checks.map((c) => ({ name: c.name, status: c.status, latencyMs: c.latencyMs }));
    const degraded = checks.filter((c) => c.status === "degraded").map((c) => c.name);
    const s = readinessState();
    const rateLimit = rateLimitDegradation();
    const revocation = jtiStoreDegradation();
    const queue = await queueBackpressureSnapshot();
    const dbRetries = dbRetrySnapshot();
    return Response.json(
      {
        status: degraded.length > 0 ? "degraded" : "ok",
        checks: safeChecks,
        degraded,
        degradedSince: degraded.length > 0 ? s.degradedSince : null,
        rateLimit,
        rateLimitDegraded: rateLimit.degraded,
        revocation,
        revocationDegraded: revocation.degraded,
        queue,
        queueBackpressured: queue.backpressured,
        dbRetries,
        ts: Date.now(),
      },
      { status: degraded.length > 0 ? 503 : 200 }
    );
  });
}
