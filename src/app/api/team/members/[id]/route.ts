import { NextResponse } from "next/server";
import { updateMemberRole, removeMember } from "@/lib/team/store";
import type { Role } from "@/lib/team/types";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// PATCH /api/team/members/[id]  { role }
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  let body: { role?: Role };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.role) return NextResponse.json({ error: "role 必填" }, { status: 400 });
  const member = updateMemberRole(id, body.role);
  if (!member) return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  return NextResponse.json({ member });
}

// DELETE /api/team/members/[id]
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const ok = removeMember(id);
  if (!ok) return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
