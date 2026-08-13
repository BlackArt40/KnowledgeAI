// ---------------------------------------------------------------------------
// Shared Q&A handler - the core SSE chat pipeline.
//
// Used by both the legacy route (/api/chat) and the versioned public API
// (/api/v1/chat, P7-1). The v1 route layers API-key scope enforcement on top
// (see src/lib/apikeys/scopes.ts) and passes its own endpoint path so key
// usage logging records the versioned URL.
//
// SSE events (asserted by tests - do not rename):
//   sources / token / done / error
// ---------------------------------------------------------------------------

import { getKb, getDocument } from "@/lib/kb/store";
import { retrieve } from "@/lib/rag/retriever";
import { generateStream } from "@/lib/rag/generator";
import { searchExternal } from "@/lib/external/provider";
import { rateLimit, kbRateLimit, rateLimitResponse, getRateLimitLimits } from "@/lib/security/rate-limit";
import type { RetrievedChunk, Citation } from "@/lib/rag/types";
import { suggestFollowUps } from "@/lib/rag/conversation-context";
import type { ChatMessage } from "@/lib/rag/conversation-context";
import {
  createConversation,
  getConversation,
  addMessage,
  popLastAssistantMessage,
} from "@/lib/chat/store";
import { deleteMessageFromDb } from "@/lib/db/persist";
import { recordQa } from "@/lib/billing/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser, type RequestUser } from "@/lib/auth/guard";
import { runWithUser } from "@/lib/models/context";
import { validateApiKey, logCall } from "@/lib/apikeys/store";
import type { ApiTraceHandle } from "@/lib/obs/trace";
import { reportError } from "@/lib/obs/errors";
import { log } from "@/lib/obs/log";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ChatRequestBody {
  kbId?: string; query?: string; conversationId?: string; webSearch?: boolean;
  /** P5-3: regenerate=true replaces the previous assistant answer server-side
   *  (it is popped from history) and may carry a different temperature / topK
   *  so the retry explores new ground instead of repeating itself. */
  regenerate?: boolean;
  temperature?: number;
  topK?: number;
  /** P7-4: image attachments (base64). Demo mode describes each image (OCR /
   *  vision) and prepends the content; with a real LLM the images are passed
   *  as OpenAI content parts for true multimodal reasoning. */
  images?: { mime: string; data: string }[];
}

export interface ChatRequestOptions {
  /** Endpoint path recorded in the API-key call log (legacy vs v1). */
  endpoint: string;
  /** Pre-authenticated user (integration callbacks such as bots, P7-2):
   *  skip the request-level auth resolution and act as this user. */
  user?: RequestUser;
  /** Skip the per-user rate-limit tier (integration callbacks are already
   *  limited by their own integration tier - the KB tier still applies). */
  skipUserTier?: boolean;
}

/** POST /api/chat  ->  text/event-stream (shared by /api/chat + /api/v1/chat). */
export async function handleChatRequest(
  req: Request,
  trace: ApiTraceHandle,
  opts: ChatRequestOptions
): Promise<Response> {
  // P6-1: finalize the trace on early-exit paths (SSE autoEnd is disabled -
  // the stream's finally below finalizes instead).
  const early = (res: Response): Response => {
    trace.end(res.status);
    return res;
  };
  const startTime = Date.now();
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const apiKey = bearerToken?.startsWith("kai_sk_") ? validateApiKey(bearerToken) : null;

  const authUser = opts.user ?? (await getRequestUser(req));
  if (!authUser) return early(Response.json({ error: "未登录" }, { status: 401 }));

  let body: ChatRequestBody;
  try { body = await req.json(); } catch {
    return early(Response.json({ error: "无效的请求体" }, { status: 400 }));
  }

  const kbId = body.kbId;
  const query = body.query?.trim();
  if (!kbId || !query) return early(Response.json({ error: "kbId 与 query 必填" }, { status: 400 }));

  const kb = getKb(kbId);
  if (!kb) return early(Response.json({ error: "知识库不存在" }, { status: 404 }));
  if (!canViewKb(kb.id, kb.name, authUser.id, kb.ownerId))
    return early(Response.json({ error: "无权访问该知识库" }, { status: 403 }));

  // P3-3: chat routes are skipped by the proxy (SSE), so enforce the user + KB
  // tiers here. Checked after auth/permission so invalid requests don't burn quota.
  if (!opts.skipUserTier) {
    const userRl = await rateLimit(`user:${authUser.id}`, getRateLimitLimits().base);
    if (!userRl.allowed) return early(rateLimitResponse(userRl, "user"));
  }
  const kbRl = await kbRateLimit(kbId);
  if (!kbRl.allowed) return early(rateLimitResponse(kbRl, "kb"));

  let conv = body.conversationId ? getConversation(body.conversationId) : undefined;
  if (!conv) conv = createConversation(kbId, query.slice(0, 24), authUser.id, authUser.workspaceId);
  // P5-3: regenerate - drop the previous assistant answer (memory + DB) so it
  // does not leak into the new generation's history, and skip adding another
  // user message (the question is already in history - adding it again would
  // duplicate it).
  let regenReplaced = false;
  if (body.regenerate) {
    const removed = popLastAssistantMessage(conv.id);
    if (removed) {
      void deleteMessageFromDb(removed.id);
      regenReplaced = true;
    }
  }
  // Build conversation history for multi-turn context (exclude current query)
  const history: ChatMessage[] = (conv.messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6) // last 3 turns
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  if (!regenReplaced) {
    addMessage(conv.id, { role: "user", content: query });
  }

  // P7-4: multimodal - describe uploaded images in demo mode (no real LLM),
  // or pass them through as content parts when a provider is configured.
  const images = (body.images ?? []).slice(0, 4);
  let effectiveQuery = query;
  let llmImages: typeof images | undefined;
  if (images.length > 0) {
    const { isLLMEnabled } = await import("@/lib/llm/provider");
    if (await isLLMEnabled()) {
      llmImages = images;
    } else {
      const { imageContextLine } = await import("@/lib/rag/vision");
      const lines: string[] = [];
      for (const img of images) {
        try {
          const buf = Buffer.from(img.data, "base64");
          const line = await imageContextLine(buf, img.mime);
          if (line) lines.push(line);
        } catch {
          // malformed image - skip
        }
      }
      if (lines.length > 0) {
        effectiveQuery = `${lines.join("\n")}\n问题：${query}`;
      }
    }
  }

  // The entire RAG flow runs inside the user's model context so the LLM
  // provider resolves THIS user's configured model.
  const doRag = async () => {
    const topK = Math.min(Math.max(body.topK ?? kb.settings.topK, 1), 20);
    let chunks: RetrievedChunk[] = await retrieve(kbId, effectiveQuery, topK);
    // P7-3: GraphRAG - when the KB has a knowledge graph, re-rank the
    // retrieved chunks via entity expansion (neighbor entities boost the
    // semantically-related chunks). Deterministic in demo mode.
    if (kb.settings.graphRag !== false) {
      try {
        const { graphRankChunks } = await import("@/lib/kg/graph-rag");
        chunks = graphRankChunks(kbId, query, chunks).chunks;
      } catch (err) {
        log.warn({ err }, "[chat] graphRag skipped");
      }
    }
    // P5-3: negative-feedback loop - down-weight chunks cited by an answer
    // the user disliked in THIS conversation, so later retrievals rank the
    // poor sources lower.
    const downvoted = new Set<string>();
    for (const m of conv!.messages) {
      if (m.role === "assistant" && m.feedback === "down") {
        for (const c of m.citations ?? []) downvoted.add(c.docId);
      }
    }
    if (downvoted.size > 0) {
      chunks = chunks
        .map((c) => (downvoted.has(c.docId) ? { ...c, score: c.score * 0.4 } : c))
        .sort((a, b) => b.score - a.score);
    }
    // P4-2: document-level permissions - drop chunks from private documents
    // (non-owner callers must not see their content through chat retrieval).
    if (authUser.id !== kb.ownerId) {
      chunks = chunks.filter((c) => {
        const doc = getDocument(c.docId);
        return !doc || doc.access !== "private";
      });
    }
    // 联网搜索：开启时同时检索外部 web 结果，合并进上下文，使回答可引用网络来源。
    if (body.webSearch) {
      const ext = await searchExternal(query, {
        config: { web: true, arxiv: false, github: false },
        maxPerSource: 5,
        deepCrawlTopN: 0,
      });
      const webChunks: RetrievedChunk[] = ext.map((r) => ({
        docId: r.id,
        docName: r.title,
        chunkIndex: 0,
        text: r.fullText || r.snippet,
        score: r.score,
        url: r.url,
        sourceType: r.sourceType,
      }));
      chunks = [...chunks, ...webChunks];
    }
    const enc = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown): boolean => {
          if (req.signal.aborted) return false;
          try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); return true; }
          catch { return false; /* client disconnected */ }
        };

        try {
          // Send chunk metadata upfront so the frontend can render citation
          // chips in real-time during streaming (before the final `done` event).
          send({
            type: "sources",
            count: chunks.length,
            chunks: chunks.map((c) => ({
              n: 0, // assigned dynamically as [n] markers appear in the stream
              docId: c.docId,
              docName: c.docName,
              chunkIndex: c.chunkIndex,
              snippet: c.text.slice(0, 180),
              score: c.score,
              ...(c.url ? { url: c.url } : {}),
              ...(c.sourceType ? { sourceType: c.sourceType } : {}),
            })),
          });
          let fullText = "";
          let citations: Citation[] = [];

          const gen = generateStream(effectiveQuery, chunks, history, body.temperature ?? 0.3, llmImages);
          let result;
          while (true) {
            // Stop generating as soon as the client disconnects / aborts.
            if (req.signal.aborted) break;
            const { value, done } = await gen.next();
            if (done) { result = value; break; }
            if (value.type === "token" && value.text) {
              fullText += value.text;
              // If send() throws the client has gone away -- stop the loop.
              const ok = send({ type: "token", text: value.text });
              if (!ok) break;
              if (chunks.length > 0 && !process.env.OPENAI_API_KEY) await sleep(22);
            }
          }
          if (result) citations = result.citations;

          const assistant = addMessage(conv!.id, { role: "assistant", content: fullText, citations });
          // Count this answered question against the current user's + workspace's meters.
          recordQa(authUser.id, authUser.workspaceId);
          // Generate follow-up question suggestions
          const followUps = await suggestFollowUps(query, fullText, chunks);
          send({ type: "done", messageId: assistant?.id, conversationId: conv!.id, title: conv!.title, citations, followUps });
        } catch (err) {
          log.error({ err }, "[chat] stream error");
          // P6-1: error reporting + trace finalization (status 500).
          reportError(err, { source: opts.endpoint, context: `conv ${conv!.id}` });
          trace.end(500, err);
          send({ type: "error", message: "生成回答时出错，请重试。" });
        } finally {
          // P6-1: the trace covers the full SSE lifetime - finalize here.
          trace.end(200);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
    });
  };

  // Log the API call if an API key was used.
  if (apiKey) {
    logCall(apiKey.id, opts.endpoint, "POST", 200, Date.now() - startTime);
  }
  return runWithUser(authUser.id, doRag);
}
