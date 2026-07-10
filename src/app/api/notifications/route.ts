import { NextResponse } from "next/server";
import {
  listNotifications,
  markAllRead,
  unreadCount,
} from "@/lib/notifications/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

// GET /api/notifications?limit=  (current user's inbox only)
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const limit = new URL(req.url).searchParams.get("limit");
  return NextResponse.json({
    notifications: listNotifications(u.id, limit ? parseInt(limit, 10) : undefined),
    unread: unreadCount(u.id),
  });
}

// POST /api/notifications  { action: "markAllRead" }
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { action?: string };
  try { body = await req.json(); } catch { body = {}; }
  if (body.action === "markAllRead") {
    markAllRead(u.id);
    return NextResponse.json({ ok: true, unread: 0 });
  }
  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
