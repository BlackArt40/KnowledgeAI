import { NextResponse } from "next/server";
import { setUserStatus } from "@/lib/admin/store";
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
