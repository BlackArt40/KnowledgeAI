import { NextResponse } from "next/server";
import { setUserStatus } from "@/lib/admin/store";
import type { UserStatus } from "@/lib/admin/types";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  let body: { status?: UserStatus };
  try { body = await req.json(); } catch { body = {}; }
  if (!body.status) return NextResponse.json({ error: "status 必填" }, { status: 400 });
  const user = setUserStatus(id, body.status);
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  return NextResponse.json({ user });
}
