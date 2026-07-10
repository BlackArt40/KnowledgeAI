import { NextResponse } from "next/server";
import { getTeam, updateTeam, listMembers } from "@/lib/team/store";
import { getKbAccess, listAudit } from "@/lib/team/store";
import { listAllKbs, listDocuments } from "@/lib/kb/store";
import { getRequestUser } from "@/lib/auth/guard";
import { getUserById } from "@/lib/auth/store";
import { can } from "@/lib/team/rbac";

export const dynamic = "force-dynamic";

// GET /api/team - team info + members + stats + shared KB access.
// Audit log is only returned to roles with member.manage (owner/admin).
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
  const sharedKbs = listAllKbs()
    .filter((kb) => {
      if (kb.ownerId === u.id) return true; // always see your own KBs
      const access = getKbAccess(kb.id, kb.name);
      return access !== "private";
    })
    .slice(0, 20)
    .map((kb) => {
      const owner = getUserById(kb.ownerId);
      return {
        kbId: kb.id,
        kbName: kb.name,
        access: getKbAccess(kb.id, kb.name),
        docs: listDocuments(kb.id).length,
        ownerName: owner?.name ?? "未知",
        isOwner: kb.ownerId === u.id,
      };
    });
  // Audit may contain sensitive activity; restrict to managers.
  const audit = can(u.role as never, "member.manage") ? listAudit().slice(0, 40) : [];
  return NextResponse.json({ team, members, stats, sharedKbs, audit });
}

// PATCH /api/team - update team settings (owner only: team.settings)
export async function PATCH(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role as never, "team.settings")) {
    return NextResponse.json({ error: "权限不足：仅 Owner 可修改团队设置" }, { status: 403 });
  }

  let body: { name?: string; logoInitial?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const team = updateTeam(body);
  return NextResponse.json({ team });
}
