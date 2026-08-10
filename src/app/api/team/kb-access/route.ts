import { NextResponse } from "next/server";
import { setKbAccess, getKbAccess, setKbMemberRole, listKbMemberRoles } from "@/lib/team/store";
import { getKb } from "@/lib/kb/store";
import { getRequestUser } from "@/lib/auth/guard";
import { can } from "@/lib/team/rbac";
import { recordAudit } from "@/lib/security/audit";
import type { KbAccess, KbMemberRole } from "@/lib/team/types";

export const dynamic = "force-dynamic";

// PATCH /api/team/kb-access  (owner/admin only)
// Body forms:
//   { kbId, access }              -> shared access level (view/edit/private)
//   { kbId, email, role }         -> per-member role override (P4-2:
//                                     "editor" | "viewer" | null to clear)
export async function PATCH(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role as never, "member.manage")) {
    return NextResponse.json({ error: "权限不足：仅 Owner/Admin 可调整共享权限" }, { status: 403 });
  }

  let body: { kbId?: string; access?: KbAccess; email?: string; role?: KbMemberRole | null };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.kbId) {
    return NextResponse.json({ error: "kbId 必填" }, { status: 400 });
  }
  const kb = getKb(body.kbId);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });

  // Per-member role override (P4-2) - only the KB owner may set member roles.
  if (body.email !== undefined) {
    if (u.id !== kb.ownerId) {
      return NextResponse.json({ error: "仅知识库所有者可设置成员权限" }, { status: 403 });
    }
    if (body.role !== "editor" && body.role !== "viewer" && body.role !== null) {
      return NextResponse.json({ error: "role 必须是 editor / viewer / null" }, { status: 400 });
    }
    const prev = listKbMemberRoles(kb.id)[body.email] ?? null;
    setKbMemberRole(kb.id, body.email, body.role);
    recordAudit({
      actorId: u.id,
      actor: u.name,
      action: "kb.access_change",
      target: kb.name,
      detail: `成员 ${body.email} 的 KB 权限由 ${prev ?? "继承"} 调整为 ${body.role ?? "继承"}`,
    });
    return NextResponse.json({ ok: true });
  }

  // Shared access level
  if (!body.access) {
    return NextResponse.json({ error: "access 或 memberId 必填" }, { status: 400 });
  }
  const prev = getKbAccess(body.kbId, kb.name);
  setKbAccess(body.kbId, body.access);
  recordAudit({
    actorId: u.id,
    actor: u.name,
    action: "kb.access_change",
    target: kb.name,
    detail: `共享权限由 ${prev} 调整为 ${body.access}`,
  });
  return NextResponse.json({ ok: true });
}
