import { NextResponse } from "next/server";
import { getTeam, updateTeam, listMembers } from "@/lib/team/store";
import { getKbAccess, listAudit, listKbMemberRoles } from "@/lib/team/store";
import { listAllKbs, listDocuments } from "@/lib/kb/store";
import { getRequestUser } from "@/lib/auth/guard";
import { getUserById } from "@/lib/auth/store";
import { can, ROLE_PERMS } from "@/lib/team/rbac";

export const dynamic = "force-dynamic";

// GET /api/team - team info + members + stats + shared KB access.
// Audit log and per-member role maps are only returned to managers (or the
// KB's owner); everyone else sees counts, not who-has-what.
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const canManage = can(u.role, "member.manage");
  const team = getTeam();
  const members = listMembers();
  const stats = {
    total: members.length,
    active: members.filter((m) => m.status === "active").length,
    invited: members.filter((m) => m.status === "invited").length,
    owners: members.filter((m) => m.role === "owner").length,
  };
  // Show ALL team KBs: the user's own KBs plus KBs shared by other
  // members (access != "private"). Private KBs are only visible to their owner.
  // M-12: scope to the caller's workspace - without it, a multi-tenant deploy
  // leaked every workspace's KB names through this endpoint.
  const sharedKbs = listAllKbs(u.workspaceId)
    .filter((kb) => {
      if (kb.ownerId === u.id) return true; // always see your own KBs
      const access = getKbAccess(kb.id, kb.name);
      return access !== "private";
    })
    .slice(0, 20)
    .map((kb) => {
      const owner = getUserById(kb.ownerId);
      const roles = listKbMemberRoles(kb.id);
      const isOwner = kb.ownerId === u.id;
      return {
        kbId: kb.id,
        kbName: kb.name,
        access: getKbAccess(kb.id, kb.name),
        docs: listDocuments(kb.id).length,
        ownerName: owner?.name ?? "未知",
        isOwner,
        // P4-2: per-member role overrides. Only managers and the KB owner may
        // see the email -> role map; everyone else gets the count so the row
        // can still say "N 位成员可编辑" without leaking team-wide grants.
        memberRoles: canManage || isOwner ? roles : {},
        memberRoleCount: Object.keys(roles).length,
      };
    });
  // Audit may contain sensitive activity; restrict to managers.
  const audit = canManage ? listAudit().slice(0, 40) : [];
  return NextResponse.json({
    team,
    members,
    stats,
    sharedKbs,
    audit,
    // UI single source of truth: the same matrix the API enforces, so the
    // team page never hardcodes ["owner","admin"] again.
    permissions: ROLE_PERMS[u.role],
    matrix: ROLE_PERMS,
  });
}

// PATCH /api/team - update team settings (owner only: team.settings)
export async function PATCH(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role, "team.settings")) {
    return NextResponse.json({ error: "权限不足：仅 Owner 可修改团队设置" }, { status: 403 });
  }

  let body: { name?: string; logoInitial?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const team = updateTeam(body);
  return NextResponse.json({ team });
}
