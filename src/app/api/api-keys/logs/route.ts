import { NextResponse } from "next/server";
import { listLogs } from "@/lib/apikeys/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";

// GET /api/api-keys/logs - current user's call logs only
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ logs: listLogs(u.id) });
}
