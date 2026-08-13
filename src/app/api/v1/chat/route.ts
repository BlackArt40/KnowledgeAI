import { handleChatRequest } from "@/lib/chat/ask";
import { requireApiKeyScope } from "@/lib/apikeys/scopes";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// POST /api/v1/chat -> text/event-stream (P7-1 versioned API)
// Same SSE pipeline as /api/chat (events: sources / token / done / error)
// plus API-key scope enforcement: Bearer kai_sk_... keys must hold chat:read.
export async function POST(req: Request) {
  return withApiTrace(
    req,
    "api /api/v1/chat",
    async (trace) => {
      const scope = await requireApiKeyScope(req, "chat:read");
      if (scope.error) {
        trace.end(scope.error.status);
        return scope.error;
      }
      return handleChatRequest(req, trace, { endpoint: "/api/v1/chat" });
    },
    { autoEnd: false }
  );
}
