import { NextResponse } from "next/server";
import { revokeAllSessions } from "@/lib/security/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
export async function DELETE(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({ sessions: revokeAllSessions(u.id) });
}
