import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { subscribe } from "@/lib/realtime/bus";
import { kbRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const HEARTBEAT_MS = 30_000;

// GET /api/kb/[id]/events - realtime KB change stream (P4-1).
// SSE events: { type: "settings" | "docs" | "doc_status" | "doc_deleted" | "deleted" }
// Anyone with KB view permission sees live changes made by other members.
// The proxy skips /api/kb for rate limiting (long-lived stream), so the
// per-KB tier is enforced here (same pattern as /api/chat).
export async function GET(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return Response.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const kb = getKb(id);
  if (!kb) return Response.json({ error: "知识库不存在" }, { status: 404 });
  if (!canViewKb(kb.id, kb.name, u.id, kb.ownerId))
    return Response.json({ error: "无权访问" }, { status: 403 });
  const rl = await kbRateLimit(id);
  if (!rl.allowed) return rateLimitResponse(rl, "kb");

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

      // Subscribe BEFORE sending anything so no event is missed.
      const unsubscribe = subscribe(`kb:${id}`, (event) => {
        send(event);
      });
      send({ type: "init", kbId: id });

      // Keep the connection alive (proxies drop idle streams).
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
