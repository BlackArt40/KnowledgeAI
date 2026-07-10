import { getKb } from "@/lib/kb/store";
import { retrieve } from "@/lib/rag/retriever";
import { generateStream } from "@/lib/rag/generator";
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

  let body: { kbId?: string; query?: string; conversationId?: string };
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

  let conv = body.conversationId ? getConversation(body.conversationId) : undefined;
  if (!conv) conv = createConversation(kbId, query.slice(0, 24), authUser.id);
  addMessage(conv.id, { role: "user", content: query });

  // The entire RAG flow runs inside the user's model context so the LLM
  // provider resolves THIS user's configured model.
  const doRag = async () => {
    const chunks = await retrieve(kbId, query, kb.settings.topK);
    const enc = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown): boolean => {
          if (req.signal.aborted) return false;
          try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); return true; }
          catch { return false; /* client disconnected */ }
        };

        try {
          send({ type: "sources", count: chunks.length });
          let fullText = "";
          let citations: { n: number; docId: string; docName: string; chunkIndex: number; snippet: string; score: number }[] = [];

          const gen = generateStream(query, chunks);
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
          send({ type: "done", messageId: assistant?.id, conversationId: conv!.id, title: conv!.title, citations });
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
