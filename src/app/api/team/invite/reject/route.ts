import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { verifyInviteToken } from "@/lib/team/invite-token";
import { removeInvitedMemberByEmail } from "@/lib/team/store";

export const dynamic = "force-dynamic";

// POST /api/team/invite/reject { token }
// Drops the pending member row. Active members are never touched; rejecting an
// already-accepted invite is a no-op error (the member is active).
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "请先登录后再处理邀请" }, { status: 401 });

  let body: { token?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const token = body.token?.trim();
  if (!token) return NextResponse.json({ error: "邀请链接无效" }, { status: 400 });

  const result = verifyInviteToken(token);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason === "expired" ? "邀请链接已过期" : "邀请链接无效" },
      { status: result.reason === "expired" ? 410 : 400 }
    );
  }
  const invite = result.payload;
  if (invite.email !== u.email.toLowerCase()) {
    return NextResponse.json({ error: "该邀请不属于当前登录账号" }, { status: 403 });
  }

  const removed = removeInvitedMemberByEmail(invite.email, u.name);
  if (!removed) {
    return NextResponse.json({ error: "没有待处理的邀请（可能已接受）" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
