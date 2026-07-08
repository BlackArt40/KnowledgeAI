import { NextResponse } from "next/server";
import { getPrefs, updatePrefs } from "@/lib/notifications/store";
import type { NotificationPrefs } from "@/lib/notifications/types";
export const dynamic = "force-dynamic";

// GET /api/notifications/preferences
export async function GET() {
  return NextResponse.json({ prefs: getPrefs() });
}

// PATCH /api/notifications/preferences  { emailDigest?, kbReady?, agentDone?, securityAlert? }
export async function PATCH(req: Request) {
  let body: Partial<NotificationPrefs>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const prefs = updatePrefs(body);
  return NextResponse.json({ prefs });
}
