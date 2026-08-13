import { handleChatRequest } from "@/lib/chat/ask";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// P6-1: request tracing + SLI metrics. autoEnd is disabled because the SSE
// stream outlives the returned Response - handleChatRequest finalizes the
// trace in the stream's finally (or on early-exit paths).
export async function POST(req: Request) {
  return withApiTrace(req, "api /api/chat", (trace) => handleChatRequest(req, trace, { endpoint: "/api/chat" }), { autoEnd: false });
}
