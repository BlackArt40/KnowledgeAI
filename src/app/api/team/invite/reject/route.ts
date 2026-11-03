import { NextResponse } from "next/server";
import { readInviteRequest } from "@/lib/team/invite-guard";
import { removeInvitedMemberByEmail } from "@/lib/team/store";

export const dynamic = "force-dynamic";

// POST /api/team/invite/reject { token }
// Drops the pending member row. Active members are never touched; rejecting an
// already-accepted invite is a no-op error (the member is active).
export async function POST(req: Request) {
  const guard = await readInviteRequest(req);
  if ("error" in guard) return guard.error;
  const { u, invite } = guard;

  const removed = removeInvitedMemberByEmail(invite.email, u.name);
  if (!removed) {
    return NextResponse.json({ error: "没有待处理的邀请（可能已接受）" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
