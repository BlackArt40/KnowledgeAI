import { withApiTrace } from "@/lib/obs/trace";
import { checkDb } from "@/lib/health/readiness";

export const dynamic = "force-dynamic";

// GET /api/health/db - database connectivity check (P6-4).
// 200 when the DB answers SELECT 1 (or is unconfigured demo mode);
// 503 when DATABASE_URL is set but the connection fails.
export async function GET(req: Request) {
  return withApiTrace(req, "api /api/health/db", async () => {
    const check = await checkDb();
    return Response.json(
      { status: check.status === "ok" ? "ok" : "error", check, ts: Date.now() },
      { status: check.status === "degraded" ? 503 : 200 }
    );
  });
}
