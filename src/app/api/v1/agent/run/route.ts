import { handleAgentRun } from "@/lib/agent/run-handler";
import { requireApiKeyScope } from "@/lib/apikeys/scopes";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// POST /api/v1/agent/run -> text/event-stream (P7-1 versioned API)
// Events: init / step / done / error. API-key callers must hold agent:run.
export async function POST(req: Request) {
  return withApiTrace(req, "api /api/v1/agent/run", async () => {
    const scope = await requireApiKeyScope(req, "agent:run");
    if (scope.error) return scope.error;
    return handleAgentRun(req);
  });
}
