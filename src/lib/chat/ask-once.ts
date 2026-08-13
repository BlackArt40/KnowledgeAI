// ---------------------------------------------------------------------------
// askOnce - non-streaming Q&A used by integration callbacks (P7-2 bots).
//
// Consumes the shared SSE pipeline in-process (same permissions, RAG, negative
// feedback and KB-tier logic as the interactive chat) and collects the full
// answer text. The per-user tier is skipped - the caller (bot route) already
// enforced its own integration tier. The trace handle is threaded through so
// RAG/LLM spans land under the bot request's API span (no noop handle).
// ---------------------------------------------------------------------------

import { handleChatRequest, type ChatRequestOptions } from "@/lib/chat/ask";
import type { RequestUser } from "@/lib/auth/guard";
import type { ApiTraceHandle } from "@/lib/obs/trace";
import { consumeSseStream } from "@/lib/sse";

export interface AskOnceResult {
  answer: string;
  citations: { docName: string; snippet: string; url?: string; sourceType?: string }[];
  error: string | null;
}

/** Run one Q&A as `user` against `kbId` and collect the full streamed answer. */
export async function askOnce(
  user: RequestUser,
  kbId: string,
  query: string,
  opts: Partial<ChatRequestOptions> & { trace?: ApiTraceHandle } = {}
): Promise<AskOnceResult> {
  const req = new Request("http://internal/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kbId, query }),
  });

  const trace = opts.trace ?? { traceId: "internal", end: () => {} };
  const res = await handleChatRequest(req, trace, {
    endpoint: opts.endpoint ?? "/api/v1/integrations/bot",
    user,
    skipUserTier: true,
    ...opts,
  });
  if (!res.body) return { answer: "", citations: [], error: "无响应体" };

  let answer = "";
  let citations: AskOnceResult["citations"] = [];
  let error: string | null = null;

  await consumeSseStream(res, (event) => {
    if (event.type === "token" && typeof event.text === "string") {
      answer += event.text;
    } else if (event.type === "done") {
      citations = (event.citations as AskOnceResult["citations"]) ?? [];
    } else if (event.type === "error") {
      error = (event.message as string) ?? "问答失败";
    }
  });

  return { answer: answer.trim(), citations, error };
}
