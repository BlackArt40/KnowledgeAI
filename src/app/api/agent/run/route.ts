import { handleAgentRun } from "@/lib/agent/run-handler";
import { requireApiKeyScope } from "@/lib/apikeys/scopes";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// POST /api/agent/run -> text/event-stream
// P6-1: request tracing + SLI metrics (autoEnd - the SSE stream here only
// relays bus events; the heavy work runs in the queue under the traceId).
// Single API surface (2026-11-27): API-key callers must hold `agent:run`.
export async function POST(req: Request) {
  return withApiTrace(req, "api /api/agent/run", async () => {
    const scope = await requireApiKeyScope(req, "agent:run");
    if (scope.error) return scope.error;
    return handleAgentRun(req, { allowApiKey: true });
  });
}
