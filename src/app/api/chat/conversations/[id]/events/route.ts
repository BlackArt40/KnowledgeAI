import { getConversation } from "@/lib/chat/store";
import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { subscribe } from "@/lib/realtime/bus";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const HEARTBEAT_MS = 30_000;

// GET /api/chat/conversations/[id]/events - live message stream for SHARED
// conversations (P4-1 collaborative Q&A). Only shared conversations are
// streamable, and only by team members who can view the underlying KB.
// Events: { type: "message", message } - one per new chat message.
export async function GET(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return Response.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return Response.json({ error: "会话不存在" }, { status: 404 });
  if (!conv.shared) return Response.json({ error: "该会话未共享" }, { status: 403 });
  const kb = getKb(conv.kbId);
  if (!kb || !canViewKb(kb.id, kb.name, u.id, kb.ownerId))
    return Response.json({ error: "无权访问" }, { status: 403 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const closeStream = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };
      const send = (obj: unknown): boolean => {
        if (req.signal.aborted || closed) return false;
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); return true; }
        catch { return false; }
      };

      const unsubscribe = subscribe(`conv:${id}`, (event) => {
        send(event);
      });
      send({ type: "init", conversationId: id });

      const ping = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(enc.encode(": ping\n\n")); } catch { closeStream(); }
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(ping);
        closeStream();
      });
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
