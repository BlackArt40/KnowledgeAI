import { getKb } from "@/lib/kb/store";
import { retrieve } from "@/lib/rag/retriever";
import { generateStream } from "@/lib/rag/generator";
import {
  createConversation,
  getConversation,
  addMessage,
} from "@/lib/chat/store";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST /api/chat  →  text/event-stream
// Body: { kbId, query, conversationId? }
//
// RAG flow: retrieve → generate (streamed).
// When LLM is configured, streams directly from OpenAI for real-time output.
// Otherwise, streams extractive answer token-by-token.
export async function POST(req: Request) {
  let body: { kbId?: string; query?: string; conversationId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "无效的请求体" }, { status: 400 });
  }

  const kbId = body.kbId;
  const query = body.query?.trim();
  if (!kbId || !query) {
    return Response.json({ error: "kbId 与 query 必填" }, { status: 400 });
  }
  const kb = getKb(kbId);
  if (!kb) return Response.json({ error: "知识库不存在" }, { status: 404 });

  // conversation
  let conv = body.conversationId ? getConversation(body.conversationId) : undefined;
  if (!conv) conv = createConversation(kbId, query.slice(0, 24));
  addMessage(conv.id, { role: "user", content: query });

  // RAG: retrieve (async — uses LLM embeddings if configured)
  const chunks = await retrieve(kbId, query, kb.settings.topK);

  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        // announce sources
        send({ type: "sources", count: chunks.length });

        let fullText = "";
        let citations: { n: number; docId: string; docName: string; chunkIndex: number; snippet: string; score: number }[] = [];

        // Stream-generate (LLM or extractive)
        const gen = generateStream(query, chunks);
        let result;
        while (true) {
          const { value, done } = await gen.next();
          if (done) {
            result = value;
            break;
          }
          if (value.type === "token" && value.text) {
            fullText += value.text;
            send({ type: "token", text: value.text });
            // small delay for extractive mode (LLM mode is naturally paced)
            if (chunks.length > 0 && !process.env.OPENAI_API_KEY) {
              await sleep(22);
            }
          }
        }

        if (result) {
          citations = result.citations;
        }

        // persist assistant message
        const assistant = addMessage(conv!.id, {
          role: "assistant",
          content: fullText,
          citations,
        });

        send({
          type: "done",
          messageId: assistant?.id,
          conversationId: conv!.id,
          title: conv!.title,
          citations,
        });
      } catch (err) {
        console.error("[chat] stream error:", err);
        send({ type: "error", message: "生成回答时出错，请重试。" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
