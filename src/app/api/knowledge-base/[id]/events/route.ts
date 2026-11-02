import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { subscribe } from "@/lib/realtime/bus";
import { getKbViewers, joinKbViewers, touchKbViewers } from "@/lib/realtime/viewers";
import { kbRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const HEARTBEAT_MS = 30_000;

// GET /api/knowledge-base/[id]/events - realtime KB change stream (P4-1).
// SSE events: { type: "settings" | "docs" | "doc_status" | "doc_deleted" |
//               "doc_access" | "deleted" | "viewers" } (+ the initial
//               { type: "init", viewers }).
// Anyone with KB view permission sees live changes made by other members.
// "viewers" carries the members currently on this KB page, so the page can
// show who else is looking at the same data.
// The proxy skips long-lived `/events` streams for rate limiting, so the
// per-KB tier is enforced here (same pattern as /api/chat).
// 2026-10-23: renamed from /api/kb/[id]/events so the whole KB surface lives
// under one prefix; the Vue client (frontend/src/lib/kb-events.ts) and
// scripts/smoke/test-realtime.ts are the only consumers.
export async function GET(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return Response.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const kb = getKb(id);
  if (!kb) return Response.json({ error: "知识库不存在" }, { status: 404 });
  if (!canViewKb(kb.id, kb.name, u.id, kb.ownerId, { callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId }))
    return Response.json({ error: "无权访问" }, { status: 403 });
  const rl = await kbRateLimit(id);
  if (!rl.allowed) return rateLimitResponse(rl, "kb");

  const enc = new TextEncoder();
  let closeStream = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let leaveViewers = () => {};
      let ping: ReturnType<typeof setInterval> | null = null;

      const send = (obj: unknown): boolean => {
        if (req.signal.aborted || closed) return false;
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); return true; }
        catch { return false; }
      };

      // Subscribe BEFORE sending anything so no event is missed.
      const unsubscribe = subscribe(`kb:${id}`, (event) => {
        send(event);
      });

      closeStream = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        leaveViewers();
        if (ping) clearInterval(ping);
        try { controller.close(); } catch { /* already closed */ }
      };

      send({ type: "init", kbId: id, viewers: getKbViewers(id) });
      // Register after the init frame so the new stream starts from a complete
      // snapshot; join publishes the updated viewer list to everyone.
      leaveViewers = joinKbViewers(id, u.id, u.name);

      // Keep the connection alive (proxies drop idle streams) and refresh the
      // viewer TTL so a long-lived tab is not treated as a dead connection.
      ping = setInterval(() => {
        if (closed) return;
        touchKbViewers(id, u.id);
        try { controller.enqueue(enc.encode(": ping\n\n")); } catch { closeStream(); }
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", closeStream);
    },
    cancel() {
      closeStream();
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
