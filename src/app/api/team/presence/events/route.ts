import { getRequestUser } from "@/lib/auth/guard";
import { subscribe } from "@/lib/realtime/bus";
import {
  connectPresence,
  getOnlineUsers,
  PRESENCE_CHANNEL,
  touchPresence,
} from "@/lib/realtime/presence";
import { createSseResponse } from "@/lib/sse-produce";

export const dynamic = "force-dynamic";

// GET /api/team/presence/events - realtime team presence stream (P4-1).
// Opening this stream marks the user ONLINE; closing it decrements the
// connection count, and the user goes OFFLINE only when the last stream
// closes. Events: { type: "presence", online: PresenceUser[] } (full list on
// every change, teams are small). An initial snapshot is sent on connect.
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return Response.json({ error: "未登录" }, { status: 401 });

  return createSseResponse(
    req,
    (sse) => {
      // Subscribe before registering so this stream also sees the snapshot
      // published by its own connect (and any concurrent change).
      const unsubscribe = subscribe(PRESENCE_CHANNEL, (event) => {
        sse.send(event);
      });
      const leave = connectPresence(u.id, u.name, u.email);
      // Initial snapshot so the client renders presence without waiting for a change.
      sse.send({ type: "presence", online: getOnlineUsers() });
      return () => {
        unsubscribe();
        leave();
      };
    },
    {
      // Keep the connection alive and refresh the presence TTL; without this a
      // long-lived tab expires after 60s.
      onHeartbeat: () => touchPresence(u.id),
    }
  );
}
