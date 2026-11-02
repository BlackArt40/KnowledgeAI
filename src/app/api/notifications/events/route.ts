import { getRequestUser } from "@/lib/auth/guard";
import { subscribe } from "@/lib/realtime/bus";
import { listNotifications, unreadCount, userChannel } from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 30_000;

// GET /api/notifications/events - realtime inbox stream.
//
// Frames:
//   init          { notifications, unread }          ← connection snapshot
//   notification  { notification, unread }           ← new inbox item
//   unread        { unread }                         ← read / delete updates
//
// The frontend keeps its 30s poll as a fallback: when this stream is open it
// stops polling, and resumes the timer if the connection drops. Route-level
// teardown is shared by the abort listener and stream cancellation.
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return Response.json({ error: "未登录" }, { status: 401 });

  const enc = new TextEncoder();
  let closeStream = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let ping: ReturnType<typeof setInterval> | null = null;

      const send = (obj: unknown): boolean => {
        if (req.signal.aborted || closed) return false;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
          return true;
        } catch {
          return false;
        }
      };

      // Subscribe before the snapshot so an event created between the two
      // cannot be lost (an extra snapshot frame would only be a duplicate).
      const unsubscribe = subscribe(userChannel(u.id), (event) => {
        send(event);
      });

      closeStream = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (ping) clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      send({
        type: "init",
        notifications: listNotifications(u.id, 10),
        unread: unreadCount(u.id),
      });

      // Keep proxies from dropping an idle stream.
      ping = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          closeStream();
        }
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
