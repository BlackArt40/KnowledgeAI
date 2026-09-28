import { requireRoleJwt as requireRole } from "@/lib/auth/guard";
import { getMetricsSnapshot } from "@/lib/obs/metrics";
import { listErrors } from "@/lib/obs/errors";
import { listTraces } from "@/lib/obs/trace";
import { getQueueStats } from "@/lib/queue";

export const dynamic = "force-dynamic";

// GET /api/admin/monitoring - observability dashboard aggregate (P6-1).
// Single endpoint: request SLIs (QPS/error rate/latency percentiles),
// RAG / LLM (tokens + cost by model) / doc / agent dimensions, a backend-
// neutral queue snapshot, plus the recent traces and errors for the lists.
export async function GET(req: Request) {
  const guard = await requireRole(req, ["owner", "admin"]);
  if (guard.error) return guard.error;

  const metrics = getMetricsSnapshot();
  const queue = await getQueueStats();
  return Response.json({
    ...metrics,
    queue,
    traces: listTraces(10),
    errors: listErrors(10),
  });
}
