import { NextResponse } from "next/server";
import { getMember, updateMemberRole, removeMember } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { can } from "@/lib/team/rbac";
import type { Role } from "@/lib/team/types";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// PATCH /api/team/members/[id]  { role }  (owner/admin only)
export async function PATCH(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role as never, "member.manage")) {
    return NextResponse.json({ error: "权限不足：仅 Owner/Admin 可管理成员" }, { status: 403 });
  }

  const { id } = await params;
  let body: { role?: Role };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.role) return NextResponse.json({ error: "role 必填" }, { status: 400 });

  const target = getMember(id);
  if (!target) return NextResponse.json({ error: "成员不存在" }, { status: 404 });

  // Guard: cannot promote anyone to owner through this endpoint.
  if (body.role === "owner") {
    return NextResponse.json({ error: "不能通过此接口设置 Owner 角色" }, { status: 403 });
  }
  // Guard: an owner's role is locked (only seeded/transferable elsewhere).
  if (target.role === "owner") {
    return NextResponse.json({ error: "不能修改 Owner 的角色" }, { status: 403 });
  }
  // Guard: don't let a user change their own role.
  if (target.email.toLowerCase() === u.email.toLowerCase()) {
    return NextResponse.json({ error: "不能修改自己的角色" }, { status: 403 });
  }

  const member = updateMemberRole(id, body.role, u.name);
  if (!member) return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  return NextResponse.json({ member });
}

// DELETE /api/team/members/[id]  (owner/admin only)
export async function DELETE(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role as never, "member.manage")) {
    return NextResponse.json({ error: "权限不足：仅 Owner/Admin 可移除成员" }, { status: 403 });
  }

  const { id } = await params;
  const target = getMember(id);
  if (!target) return NextResponse.json({ error: "成员不存在" }, { status: 404 });

  // Guard: owners cannot be removed (prevents leaving the team ownerless).
  if (target.role === "owner") {
    return NextResponse.json({ error: "不能移除 Owner" }, { status: 403 });
  }
  // Guard: don't let a user remove themselves.
  if (target.email.toLowerCase() === u.email.toLowerCase()) {
    return NextResponse.json({ error: "不能移除自己" }, { status: 403 });
  }

  const ok = removeMember(id, u.name);
  if (!ok) return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
