import { NextResponse } from "next/server";
import { revokeSession } from "@/lib/security/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
export async function DELETE(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ sessions: revokeSession(u.id, id) });
}
