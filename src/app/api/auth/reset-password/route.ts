import { NextResponse } from "next/server";
import { resetPassword } from "@/lib/auth/password-reset";
import { recordAudit } from "@/lib/security/audit";
import { clientInfoFromRequest } from "@/lib/security/ua";
export const dynamic = "force-dynamic";

// POST /api/auth/reset-password { token, password }
// Consumes the reset token: rehashes the password, clears the token,
// revokes every session (forced re-login) and lifts any login lockout.
export async function POST(req: Request) {
  let body: { token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const token = body.token?.trim();
  const password = body.password;
  if (!token || !password) {
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });
  }

  const result = await resetPassword(token, password);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const info = clientInfoFromRequest(req);
  recordAudit({
    actorId: result.userId,
    actor: result.name,
    action: "auth.password_reset",
    target: "密码重置",
    detail: `修改密码（会话已全部失效） · ${info.ip}`,
    ip: info.ip,
  });

  return NextResponse.json({ ok: true });
}