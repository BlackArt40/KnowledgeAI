import { handleAgentRun } from "@/lib/agent/run-handler";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// POST /api/agent/run -> text/event-stream
// P6-1: request tracing + SLI metrics (autoEnd - the SSE stream here only
// relays bus events; the heavy work runs in the queue under the traceId).
export async function POST(req: Request) {
  return withApiTrace(req, "api /api/agent/run", () => handleAgentRun(req));
}
