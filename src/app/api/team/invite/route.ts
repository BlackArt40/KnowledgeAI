import { NextResponse } from "next/server";
import { inviteMember } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { can } from "@/lib/team/rbac";
import type { Role } from "@/lib/team/types";

export const dynamic = "force-dynamic";

// POST /api/team/invite  { name?, email, role }  (owner/admin only)
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role as never, "member.invite")) {
    return NextResponse.json({ error: "权限不足：仅 Owner/Admin 可邀请成员" }, { status: 403 });
  }

  let body: { name?: string; email?: string; role?: Role };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.email?.trim()) {
    return NextResponse.json({ error: "邮箱不能为空" }, { status: 400 });
  }
  // Only owners may invite at owner level; managers cannot grant owner.
  if (body.role === "owner" && !can(u.role as never, "team.settings")) {
    return NextResponse.json({ error: "权限不足：仅 Owner 可邀请 Owner" }, { status: 403 });
  }

  const member = inviteMember(
    { name: body.name ?? "", email: body.email.trim(), role: body.role ?? "viewer" },
    u.name
  );
  return NextResponse.json({ member }, { status: 201 });
}
