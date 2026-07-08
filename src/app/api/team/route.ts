import { NextResponse } from "next/server";
import { getTeam, updateTeam, listMembers } from "@/lib/team/store";
import { getKbAccess, listAudit } from "@/lib/team/store";
import { listKbs, listDocuments } from "@/lib/kb/store";

export const dynamic = "force-dynamic";

// GET /api/team — team info + members + stats + shared KB access
export async function GET() {
  const team = getTeam();
  const members = listMembers();
  const stats = {
    total: members.length,
    active: members.filter((m) => m.status === "active").length,
    invited: members.filter((m) => m.status === "invited").length,
    owners: members.filter((m) => m.role === "owner").length,
  };
  const sharedKbs = listKbs().slice(0, 6).map((kb) => ({
    kbId: kb.id,
    kbName: kb.name,
    access: getKbAccess(kb.id, kb.name),
    docs: listDocuments(kb.id).length,
  }));
  const audit = listAudit().slice(0, 40);
  return NextResponse.json({ team, members, stats, sharedKbs, audit });
}

// PATCH /api/team — update team settings
export async function PATCH(req: Request) {
  let body: { name?: string; logoInitial?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const team = updateTeam(body);
  return NextResponse.json({ team });
}
