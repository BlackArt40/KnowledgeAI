import { NextResponse } from "next/server";
import { readInviteRequest } from "@/lib/team/invite-guard";
import { activateMemberByEmail, findMemberByEmail } from "@/lib/team/store";
import { releaseInviteSeat } from "@/lib/team/invite-seats";
import { addWorkspaceMember, getWorkspace } from "@/lib/workspace/store";
import { getPlan } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

// POST /api/team/invite/accept { token }
// Signed, 7-day payload (email + role + workspace). Accepting is idempotent:
// the invited member row becomes active and the workspace gains the email.
export async function POST(req: Request) {
  const guard = await readInviteRequest(req);
  if ("error" in guard) return guard.error;
  const { u, invite } = guard;

  // Re-check the workspace seat budget at accept time: invitations do not
  // reserve a seat, so a plan downgrade or concurrent invites must not oversell.
  const ws = getWorkspace(invite.workspaceId);
  if (ws && !ws.members.includes(invite.email)) {
    const seats = getPlan(ws.plan).seats;
    if (seats !== null && ws.members.length >= seats) {
      return NextResponse.json(
        { error: `当前套餐席位已满（${ws.members.length}/${seats}），请联系管理员升级`, code: "seats_full" },
        { status: 409 }
      );
    }
  }

  // The token carries the role at invite time; if an admin changed the pending
  // member's role afterwards, the admin's latest intent wins.
  const existing = findMemberByEmail(invite.email);
  if (!existing) {
    return NextResponse.json({ error: "邀请对应的成员记录不存在，请让管理员重新邀请" }, { status: 404 });
  }
  const member = activateMemberByEmail(invite.email, existing.role, u.name);
  if (!member) {
    return NextResponse.json({ error: "邀请对应的成员记录不存在，请让管理员重新邀请" }, { status: 404 });
  }
  releaseInviteSeat(invite.workspaceId, invite.email);
  // Joining the workspace is what makes the team's KBs visible; a deleted
  // workspace just leaves the team membership in place.
  addWorkspaceMember(invite.workspaceId, invite.email);
  return NextResponse.json({ ok: true, member });
}
