import { getKb } from "@/lib/kb/store";
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
} from "@/lib/chat/store";
import { recordQa } from "@/lib/billing/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { runWithUser } from "@/lib/models/context";
import { validateApiKey, logCall } from "@/lib/apikeys/store";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST /api/chat  ->  text/event-stream
export async function POST(req: Request) {
  const startTime = Date.now();
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const apiKey = bearerToken?.startsWith("kai_sk_") ? validateApiKey(bearerToken) : null;

  const authUser = await getRequestUser(req);
  if (!authUser) return Response.json({ error: "未登录" }, { status: 401 });

  let body: { kbId?: string; query?: string; conversationId?: string; webSearch?: boolean };
  try { body = await req.json(); } catch {
    return Response.json({ error: "无效的请求体" }, { status: 400 });
  }

  const kbId = body.kbId;
  const query = body.query?.trim();
  if (!kbId || !query) return Response.json({ error: "kbId 与 query 必填" }, { status: 400 });

  const kb = getKb(kbId);
  if (!kb) return Response.json({ error: "知识库不存在" }, { status: 404 });
  if (!canViewKb(kb.id, kb.name, authUser.id, kb.ownerId))
    return Response.json({ error: "无权访问该知识库" }, { status: 403 });

  // P3-3: /api/chat is skipped by the proxy (SSE), so enforce the user + KB
  // tiers here. Checked after auth/permission so invalid requests don't burn quota.
  const userRl = await rateLimit(`user:${authUser.id}`, getRateLimitLimits().base);
  if (!userRl.allowed) return rateLimitResponse(userRl, "user");
  const kbRl = await kbRateLimit(kbId);
  if (!kbRl.allowed) return rateLimitResponse(kbRl, "kb");

  let conv = body.conversationId ? getConversation(body.conversationId) : undefined;
  if (!conv) conv = createConversation(kbId, query.slice(0, 24), authUser.id);
  // Build conversation history for multi-turn context (exclude current query)
  const history: ChatMessage[] = (conv.messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-6) // last 3 turns
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  addMessage(conv.id, { role: "user", content: query });

  // The entire RAG flow runs inside the user's model context so the LLM
  // provider resolves THIS user's configured model.
  const doRag = async () => {
    let chunks: RetrievedChunk[] = await retrieve(kbId, query, kb.settings.topK);
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

          const gen = generateStream(query, chunks, history);
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
          // Count this answered question against the current user's meters.
          recordQa(authUser.id);
          // Generate follow-up question suggestions
          const followUps = await suggestFollowUps(query, fullText, chunks);
          send({ type: "done", messageId: assistant?.id, conversationId: conv!.id, title: conv!.title, citations, followUps });
        } catch (err) {
          console.error("[chat] stream error:", err);
          send({ type: "error", message: "生成回答时出错，请重试。" });
        } finally {
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
    logCall(apiKey.id, "/api/chat", "POST", 200, Date.now() - startTime);
  }
  return runWithUser(authUser.id, doRag);
}
