import { NextResponse } from "next/server";
import { getPrefs, updatePrefs } from "@/lib/notifications/store";
import type { NotificationPrefs } from "@/lib/notifications/types";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";

// GET /api/notifications/preferences  (current user's preferences)
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ prefs: getPrefs(u.id) });
}

// PATCH /api/notifications/preferences  { emailDigest?, kbReady?, agentDone?, securityAlert? }
export async function PATCH(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: Partial<NotificationPrefs>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const prefs = updatePrefs(u.id, body);
  return NextResponse.json({ prefs });
}
