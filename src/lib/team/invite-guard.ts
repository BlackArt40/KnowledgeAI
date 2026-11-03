// Shared guard for /api/team/invite/accept|reject: auth + body + token signature
// + invited-email ownership. Keeps the two routes from drifting apart.
import { NextResponse } from "next/server";
import { getRequestUser, type RequestUser } from "@/lib/auth/guard";
import { verifyInviteToken, type InvitePayload } from "./invite-token";

export type InviteGuardResult =
  | { u: RequestUser; invite: InvitePayload }
  | { error: NextResponse };

export async function readInviteRequest(req: Request): Promise<InviteGuardResult> {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "请先登录后再处理邀请" }, { status: 401 }) };

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return { error: NextResponse.json({ error: "无效的请求体" }, { status: 400 }) };
  }
  const token = body.token?.trim();
  if (!token) return { error: NextResponse.json({ error: "邀请链接无效" }, { status: 400 }) };

  const result = verifyInviteToken(token);
  if (!result.ok) {
    return {
      error: NextResponse.json(
        {
          error:
            result.reason === "expired"
              ? "邀请链接已过期，请让管理员重新邀请"
              : "邀请链接无效",
        },
        { status: result.reason === "expired" ? 410 : 400 }
      ),
    };
  }
  if (result.payload.email !== u.email.toLowerCase()) {
    return { error: NextResponse.json({ error: "该邀请不属于当前登录账号" }, { status: 403 }) };
  }
  return { u, invite: result.payload };
}
