import { withApiTrace } from "@/lib/obs/trace";
import { checkReadiness, alertOnReadiness, readinessState } from "@/lib/health/readiness";

export const dynamic = "force-dynamic";

// GET /api/health/ready - readiness probe (P6-4).
// Runs DB / Redis / LLM connectivity checks in parallel and reports the
// aggregate: 200 "ok" when nothing is degraded (unconfigured deps in demo
// mode count as "skipped", which is a valid running state); 503 "degraded"
// when any configured dependency is unreachable. Drives the alert state
// machine (ok->degraded / recovery notifications, 10-min re-alert dedupe).
export async function GET(req: Request) {
  return withApiTrace(req, "api /api/health/ready", async () => {
    const checks = await checkReadiness();
    alertOnReadiness(checks);
    const degraded = checks.filter((c) => c.status === "degraded").map((c) => c.name);
    const s = readinessState();
    return Response.json(
      {
        status: degraded.length > 0 ? "degraded" : "ok",
        checks,
        degraded,
        degradedSince: degraded.length > 0 ? s.degradedSince : null,
        ts: Date.now(),
      },
      { status: degraded.length > 0 ? 503 : 200 }
    );
  });
}
