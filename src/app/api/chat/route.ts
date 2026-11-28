import { handleChatRequest } from "@/lib/chat/ask";
import { requireApiKeyScope } from "@/lib/apikeys/scopes";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// P6-1: request tracing + SLI metrics. autoEnd is disabled because the SSE
// stream outlives the returned Response - handleChatRequest finalizes the
// trace in the stream's finally (or on early-exit paths).
//
// Single API surface (2026-11-27): API-key callers (SDK / widget / extensions)
// must hold the `chat:read` scope; JWT sessions pass through untouched.
export async function POST(req: Request) {
  return withApiTrace(
    req,
    "api /api/chat",
    async (trace) => {
      const scope = await requireApiKeyScope(req, "chat:read");
      if (scope.error) {
        trace.end(scope.error.status);
        return scope.error;
      }
      return handleChatRequest(req, trace, { endpoint: "/api/chat", allowApiKey: true });
    },
    { autoEnd: false }
  );
}
