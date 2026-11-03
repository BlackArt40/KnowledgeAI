import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { verifyInviteToken } from "@/lib/team/invite-token";
import { activateMemberByEmail } from "@/lib/team/store";
import { addWorkspaceMember } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

// POST /api/team/invite/accept { token }
// The token is a signed, 7-day payload (email + role + workspace). Accepting is
// idempotent: the invited member row becomes active and the workspace gains the
// email. Only the invited account may accept (email must match the session).
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "请先登录后再接受邀请" }, { status: 401 });

  let body: { token?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const token = body.token?.trim();
  if (!token) return NextResponse.json({ error: "邀请链接无效" }, { status: 400 });

  const result = verifyInviteToken(token);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === "expired" ? "邀请链接已过期，请让管理员重新邀请" : "邀请链接无效" },
      { status: result.reason === "expired" ? 410 : 400 }
    );
  }
  const invite = result.payload;
  if (invite.email !== u.email.toLowerCase()) {
    return NextResponse.json({ error: "该邀请不属于当前登录账号" }, { status: 403 });
  }

  const member = activateMemberByEmail(invite.email, invite.role, u.name);
  if (!member) {
    return NextResponse.json({ error: "邀请对应的成员记录不存在，请让管理员重新邀请" }, { status: 404 });
  }
  // Joining the workspace is what makes the team's KBs visible; a deleted
  // workspace just leaves the team membership in place.
  addWorkspaceMember(invite.workspaceId, invite.email);
  return NextResponse.json({ ok: true, member });
}
