import { NextResponse } from "next/server";
import {
  findMemberByEmail,
  setKbAccess,
  getKbAccess,
  setKbMemberRole,
  listKbMemberRoles,
} from "@/lib/team/store";
import { getKb } from "@/lib/kb/store";
import { getRequestUser } from "@/lib/auth/guard";
import { can } from "@/lib/team/rbac";
import { recordAudit } from "@/lib/security/audit";
import { notifyManagers, notifyMember, notifyTeam } from "@/lib/team/notify";
import type { KbAccess, KbMemberRole } from "@/lib/team/types";

export const dynamic = "force-dynamic";

const ACCESS_LEVELS: KbAccess[] = ["view", "edit", "private"];
const ACCESS_LABEL: Record<KbAccess, string> = {
  view: "所有人可读",
  edit: "成员可编辑",
  private: "仅 Owner/Admin",
};

// PATCH /api/team/kb-access
// Body forms:
//   { kbId, access }              -> shared access level (view/edit/private)
//   { kbId, email, role }         -> per-member role override (P4-2:
//                                     "editor" | "viewer" | null to clear)
// Who may call: team Owner/Admin (member.manage) OR the KB's owner. The KB
// owner is the authority for their own library - they must not need a global
// admin to open or lock it.
export async function PATCH(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { kbId?: string; access?: KbAccess; email?: string; role?: KbMemberRole | null };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.kbId) {
    return NextResponse.json({ error: "kbId 必填" }, { status: 400 });
  }
  const kb = getKb(body.kbId);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  // P4-3: tenant boundary. The KB comes from a caller-supplied id, so this
  // route must scope exactly like /api/knowledge-base/[id] (canViewKb /
  // canEditKb already deny the cross-workspace read). Without it an admin of
  // another workspace could rewrite kbAccess on a KB they cannot even read:
  // "edit" loosens it for every member of the owning workspace, "private"
  // locks those members out.
  if (kb.workspaceId !== u.workspaceId)
    return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const isKbOwner = kb.ownerId === u.id;
  if (!can(u.role, "member.manage") && !isKbOwner) {
    return NextResponse.json({ error: "权限不足：仅 Owner/Admin 或知识库所有者可调整共享权限" }, { status: 403 });
  }

  // Per-member role override (P4-2) - only the KB owner may set member roles.
  // Team managers can change the shared access level, but delegating access to
  // a specific person stays with the library's owner.
  if (body.email !== undefined) {
    if (!isKbOwner) {
      return NextResponse.json({ error: "仅知识库所有者可设置成员权限" }, { status: 403 });
    }
    const email = body.email.trim().toLowerCase();
    if (!findMemberByEmail(email)) {
      return NextResponse.json({ error: "该邮箱不是团队成员" }, { status: 404 });
    }
    if (body.role !== "editor" && body.role !== "viewer" && body.role !== null) {
      return NextResponse.json({ error: "role 必须是 editor / viewer / null" }, { status: 400 });
    }
    const prev = listKbMemberRoles(kb.id)[email] ?? null;
    setKbMemberRole(kb.id, email, body.role);
    recordAudit({
      actorId: u.id,
      actor: u.name,
      action: "kb.access_change",
      target: kb.name,
      detail: `成员 ${email} 的 KB 权限由 ${prev ?? "继承"} 调整为 ${body.role ?? "继承"}`,
    });
    notifyMember(
      email,
      {
        title: "知识库权限已更新",
        body: `你在知识库「${kb.name}」的权限已调整为 ${body.role ?? "继承"}`,
        link: `/knowledge-base/${kb.id}`,
      },
      { exceptUserId: u.id }
    );
    return NextResponse.json({ ok: true });
  }

  // Shared access level
  if (!body.access || !ACCESS_LEVELS.includes(body.access)) {
    return NextResponse.json({ error: "access 必须是 view / edit / private" }, { status: 400 });
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
  // private hides the KB from everyone but managers/owner, so do not fan the
  // name out to all members; view/edit keeps it visible to the team.
  const audience = body.access === "private" ? notifyManagers : notifyTeam;
  audience(
    {
      title: "知识库共享权限已更新",
      body: `${u.name} 已将「${kb.name}」的共享权限调整为${ACCESS_LABEL[body.access]}`,
      link: `/knowledge-base/${kb.id}`,
    },
    { exceptUserId: u.id, includeUserId: kb.ownerId }
  );
  return NextResponse.json({ ok: true });
}
