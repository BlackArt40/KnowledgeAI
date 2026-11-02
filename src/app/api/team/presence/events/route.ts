import { getRequestUser } from "@/lib/auth/guard";
import { subscribe } from "@/lib/realtime/bus";
import {
  connectPresence,
  getOnlineUsers,
  PRESENCE_CHANNEL,
  touchPresence,
} from "@/lib/realtime/presence";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 30_000;

// GET /api/team/presence/events - realtime team presence stream (P4-1).
// Opening this stream marks the user ONLINE; closing it decrements the
// connection count, and the user goes OFFLINE only when the last stream
// closes. Events: { type: "presence", online: PresenceUser[] } (full list on
// every change, teams are small). An initial snapshot is sent on connect.
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return Response.json({ error: "未登录" }, { status: 401 });

  const enc = new TextEncoder();
  // Route-level teardown shared by the abort listener and stream cancellation.
  // Assigned inside start(); both callers can only run after start().
  let closeStream = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let leave = () => {};
      let ping: ReturnType<typeof setInterval> | null = null;

      const send = (obj: unknown): boolean => {
        if (req.signal.aborted || closed) return false;
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); return true; }
        catch { return false; }
      };

      // Subscribe before registering so this stream also sees the snapshot
      // published by its own connect (and any concurrent change).
      const unsubscribe = subscribe(PRESENCE_CHANNEL, (event) => {
        send(event);
      });

      closeStream = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        leave();
        if (ping) clearInterval(ping);
        try { controller.close(); } catch { /* already closed */ }
      };

      leave = connectPresence(u.id, u.name, u.email);
      // Initial snapshot so the client renders presence without waiting for a change.
      send({ type: "presence", online: getOnlineUsers() });

      // Keep the connection alive (proxies drop idle streams) and refresh the
      // presence TTL: without this a long-lived tab expires after 60s.
      ping = setInterval(() => {
        if (closed) return;
        touchPresence(u.id);
        try { controller.enqueue(enc.encode(": ping\n\n")); } catch { closeStream(); }
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", closeStream);
    },
    cancel() {
      // Client disconnected without a request abort (e.g. tab closed).
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
