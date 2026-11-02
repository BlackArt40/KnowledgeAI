import { NextResponse } from "next/server";
import { getMember, updateMemberRole, removeMember } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { can, isRole, canManageMember, outranks } from "@/lib/team/rbac";
import { notifyMember, roleLabel } from "@/lib/team/notify";
import type { Role } from "@/lib/team/types";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// PATCH /api/team/members/[id]  { role }  (owner/admin only)
export async function PATCH(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role, "member.manage")) {
    return NextResponse.json({ error: "权限不足：仅 Owner/Admin 可管理成员" }, { status: 403 });
  }

  const { id } = await params;
  let body: { role?: Role };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!isRole(body.role)) return NextResponse.json({ error: "role 必须是 owner/admin/editor/viewer" }, { status: 400 });

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
  // Relative authority: peers and superiors are out of reach. Without this an
  // admin could demote every other admin (and then remove them).
  if (!canManageMember(u.role, target.role)) {
    return NextResponse.json({ error: "权限不足：不能管理同级或更高权限的成员" }, { status: 403 });
  }
  // A manager cannot mint peers: admin may only assign editor/viewer.
  if (!outranks(u.role, body.role)) {
    return NextResponse.json({ error: "权限不足：不能授予与自己相同或更高的角色" }, { status: 403 });
  }

  const member = updateMemberRole(id, body.role, u.name);
  if (!member) return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  notifyMember(
    member.email,
    {
      title: "团队角色已更新",
      body: `${u.name} 将你的角色调整为 ${roleLabel(member.role)}`,
      link: "/team",
    },
    { exceptUserId: u.id }
  );
  return NextResponse.json({ member });
}

// DELETE /api/team/members/[id]  (owner/admin only)
export async function DELETE(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role, "member.manage")) {
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
  // Same hierarchy rule as role changes: no removing peers/superiors.
  if (!canManageMember(u.role, target.role)) {
    return NextResponse.json({ error: "权限不足：不能移除同级或更高权限的成员" }, { status: 403 });
  }

  const ok = removeMember(id, u.name);
  if (!ok) return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  notifyMember(target.email, {
    title: "你已被移出团队",
    body: `${u.name} 已将你从团队中移除`,
    link: "/team",
  });
  return NextResponse.json({ ok: true });
}
