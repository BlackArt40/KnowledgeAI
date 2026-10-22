import { NextResponse } from "next/server";
import { deleteUserDeep, setUserStatus } from "@/lib/admin/store";
import { getUserById } from "@/lib/auth/store";
import type { UserStatus } from "@/lib/admin/types";
import { requireRoleJwt as requireRole } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/security/audit";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
export async function PATCH(req: Request, { params }: Params) {
  const guard = await requireRole(req, ["owner", "admin"]);
  if (guard.error) return guard.error;
  const { id } = await params;
  let body: { status?: UserStatus };
  try { body = await req.json(); } catch { body = {}; }
  if (!body.status) return NextResponse.json({ error: "status 必填" }, { status: 400 });
  const user = setUserStatus(id, body.status);
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  recordAudit({
    actorId: guard.user.id,
    actor: guard.user.name,
    action: body.status === "banned" ? "admin.user_ban" : "admin.user_unban",
    target: `${user.name} (${user.email})`,
    detail: body.status === "banned" ? "封禁用户" : "解封用户",
  });
  return NextResponse.json({ user });
}

/**
 * DELETE /api/admin/users/[id] - 彻底删除账号（**仅 Owner**）。
 *
 * 之前只能进数据库删，导致 e2e/演示账号清理没有正规入口。守卫：
 * 仅 Owner 可调用（删号不可逆，权限级别高于可逆的封禁）、
 * 不能删自己（避免误操作把当前会话变成幽灵）、不能删 Owner（团队会失去所有者），
 * 且操作写入审计。数据清理口径与自助删号一致（见 admin/store.deleteUserDeep）。
 */
export async function DELETE(req: Request, { params }: Params) {
  const guard = await requireRole(req, ["owner"]);
  if (guard.error) return guard.error;
  const { id } = await params;

  if (id === guard.user.id) {
    return NextResponse.json({ error: "不能删除自己的账号" }, { status: 400 });
  }
  const target = getUserById(id);
  if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  if (target.role === "owner") {
    return NextResponse.json({ error: "Owner 账户不可删除，请先转移所有权" }, { status: 403 });
  }

  const ok = await deleteUserDeep(target.id);
  if (!ok) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  recordAudit({
    actorId: guard.user.id,
    actor: guard.user.name,
    action: "admin.user_delete",
    target: `${target.name} (${target.email})`,
    detail: "删除用户及其数据",
  });
  return NextResponse.json({ ok: true, id: target.id });
}
