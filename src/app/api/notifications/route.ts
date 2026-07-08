import { NextResponse } from "next/server";
import { listNotifications, markAllRead, unreadCount } from "@/lib/notifications/store";
export const dynamic = "force-dynamic";

// GET /api/notifications?limit=
export async function GET(req: Request) {
  const limit = new URL(req.url).searchParams.get("limit");
  return NextResponse.json({
    notifications: listNotifications(limit ? parseInt(limit, 10) : undefined),
    unread: unreadCount(),
  });
}

// POST /api/notifications  { action: "markAllRead" }
export async function POST(req: Request) {
  let body: { action?: string };
  try { body = await req.json(); } catch { body = {}; }
  if (body.action === "markAllRead") {
    markAllRead();
    return NextResponse.json({ ok: true, unread: 0 });
  }
  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
