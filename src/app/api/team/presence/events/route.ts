import { getRequestUser } from "@/lib/auth/guard";
import { subscribe } from "@/lib/realtime/bus";
import { heartbeat, markOffline, getOnlineUsers, PRESENCE_CHANNEL } from "@/lib/realtime/presence";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 30_000;

// GET /api/team/presence/events - realtime team presence stream (P4-1).
// Opening this stream marks the user ONLINE; closing (or abort) marks them
// OFFLINE. Events: { type: "presence", online: PresenceUser[] } (full list
// on every change, teams are small). An initial snapshot is sent on connect.
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return Response.json({ error: "未登录" }, { status: 401 });

  // Connection == online. The heartbeat is refreshed on every connect (SSE
  // streams reconnect), and removed on abort.
  heartbeat(u.id, u.name, u.email);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const closeStream = () => {
        if (closed) return;
        closed = true;
        markOffline(u.id);
        try { controller.close(); } catch { /* already closed */ }
      };
      const send = (obj: unknown): boolean => {
        if (req.signal.aborted || closed) return false;
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); return true; }
        catch { return false; }
      };

      const unsubscribe = subscribe(PRESENCE_CHANNEL, (event) => {
        send(event);
      });
      // Initial snapshot so the client renders presence without waiting for a change.
      send({ type: "presence", online: getOnlineUsers() });

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
