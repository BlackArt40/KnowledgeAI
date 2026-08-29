import { NextResponse } from "next/server";
import { createUser, sanitize } from "@/lib/auth/store";
import { getConfig } from "@/lib/admin/store";
import { createToken } from "@/lib/auth/session";
import { issueEmailVerification } from "@/lib/auth/email-verify";
import { addSession, recordLogin } from "@/lib/security/store";
import { clientInfoFromRequest } from "@/lib/security/ua";
import { isEmailEnabled } from "@/lib/email";
import { authLink, demoLinksAllowed, enqueueEmailSend } from "@/lib/email/deliver";
export const dynamic = "force-dynamic";

// POST /api/auth/register { name, email, password }
export async function POST(req: Request) {
  let body: { name?: string; email?: string; password?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  // Check if registration is allowed (admin config).
  if (!getConfig().allowSignup) {
    return NextResponse.json({ error: "管理员已关闭新用户注册" }, { status: 403 });
  }

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!name || !email || !password) {
    return NextResponse.json({ error: "昵称、邮箱、密码必填" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "密码至少 8 位" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }

  const result = await createUser(name, email, password, "editor");
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  // P1-3: register the session + tie the JWT jti to it (consistent with the
  // login flow) so "注销设备" revokes this token too.
  const info = clientInfoFromRequest(req);
  const sessions = addSession(result.id, info);
  recordLogin(result.id, { device: info.device, ip: info.ip, location: info.location, success: true });

  const token = await createToken({
    id: result.id,
    email: result.email,
    name: result.name,
    role: result.role,
  }, 7 * 86400, { jti: sessions[0]?.id });

  // P8: issue + deliver the email-verification link. This is a SOFT gate -
  // signup fully succeeds (session issued) and verification proves inbox
  // ownership as a trust signal. Demo mode (no mailer) returns the link in
  // the response outside production (demoLinksAllowed - same enumeration
  // reasoning as forgot-password; the just-registered caller is the account
  // owner, but the gate keeps the rule uniform).
  let needsVerification = false;
  let demoVerifyUrl: string | undefined;
  const verifyToken = issueEmailVerification(result.email);
  if (verifyToken) {
    needsVerification = true;
    const verifyUrl = authLink(req, "/verify-email", verifyToken);
    if (!isEmailEnabled()) {
      if (demoLinksAllowed()) {
        demoVerifyUrl = verifyUrl;
      }
    } else {
      enqueueEmailSend({ to: result.email, url: verifyUrl, kind: "verify" });
    }
  }

  const res = NextResponse.json(
    { user: sanitize(result), token, needsVerification, ...(demoVerifyUrl ? { demoVerifyUrl } : {}) },
    { status: 201 }
  );
  res.cookies.set("kai-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 86400,
    path: "/",
  });
  return res;
}
