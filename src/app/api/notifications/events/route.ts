import { getRequestUser } from "@/lib/auth/guard";
import { createSseResponse } from "@/lib/sse-produce";
import { subscribe } from "@/lib/realtime/bus";
import { listNotifications, unreadCount, userChannel } from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

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

  return createSseResponse(req, (sse) => {
    // Subscribe before the snapshot so an event created between the two cannot
    // be lost (an extra snapshot frame would only be a duplicate).
    const unsubscribe = subscribe(userChannel(u.id), (event) => {
      sse.send(event);
    });

    sse.send({
      type: "init",
      notifications: listNotifications(u.id, 10),
      unread: unreadCount(u.id),
    });

    return unsubscribe;
  });
}
