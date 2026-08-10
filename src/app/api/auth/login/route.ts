import { NextResponse } from "next/server";
import { verifyCredentials, sanitize } from "@/lib/auth/store";
import { createToken, createPreAuthToken } from "@/lib/auth/session";
import { notify } from "@/lib/notifications/store";
import { addSession, recordLogin, is2FAEnabled, verify2FALogin, mustEnroll2FA } from "@/lib/security/store";
import { clientInfoFromRequest } from "@/lib/security/ua";
import { recordAudit } from "@/lib/security/audit";
export const dynamic = "force-dynamic";

// POST /api/auth/login { email, password, totpCode? }
// Three possible outcomes once the password is verified:
//   1. 2FA enabled            -> { requires2FA: true } (client re-calls with totpCode)
//   2. 2FA required by admin  -> { mustEnroll2FA: true, preAuthToken } (forced enrollment)
//                               but not yet enabled
//   3. Otherwise              -> { user, token } (session issued)
export async function POST(req: Request) {
  let body: { email?: string; password?: string; totpCode?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const email = body.email?.trim();
  const password = body.password;

  if (!email || !password) {
    return NextResponse.json({ error: "邮箱和密码必填" }, { status: 400 });
  }

  // Client info is needed for failed-login auditing and for the successful
  // login record, so resolve it once up front.
  const info = clientInfoFromRequest(req);

  const user = await verifyCredentials(email, password);
  if (!user) {
    // P3-4: failed password attempts are sensitive - audit them (no user id
    // exists yet, so the attempted email is recorded as the actor).
    recordAudit({
      actorId: null,
      actor: email,
      action: "auth.login_failed",
      target: "登录",
      detail: "密码错误",
      ip: info.ip,
    });
    return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
  }

  // ── 2FA check ──────────────────────────────────────────────────────────
  if (is2FAEnabled(user.id)) {
    if (!body.totpCode) {
      // First step: password OK, but 2FA required
      return NextResponse.json({
        requires2FA: true,
        message: "请输入两步验证码",
      });
    }
    // Verify TOTP or backup code. A wrong code is a failed login attempt -
    // record it so brute-force tries surface in the user's login history.
    if (!verify2FALogin(user.id, body.totpCode.trim())) {
      recordLogin(user.id, { device: info.device, ip: info.ip, location: info.location, success: false });
      recordAudit({
        actorId: user.id,
        actor: user.name,
        action: "auth.login_failed_2fa",
        target: "两步验证",
        detail: "TOTP/恢复码验证失败",
        ip: info.ip,
      });
      return NextResponse.json({ error: "两步验证码不正确" }, { status: 401 });
    }
  } else if (mustEnroll2FA(user.id, user.role)) {
    // Admin requires 2FA for this role but the user hasn't enrolled yet.
    // Issue a short-lived pre-auth token so they can enroll, but do NOT
    // create a session until enrollment completes.
    const preAuthToken = await createPreAuthToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
    return NextResponse.json({
      mustEnroll2FA: true,
      preAuthToken,
      message: "管理员已为该角色开启两步验证强制策略，请先完成两步验证绑定。",
    });
  }

  // Record this real login: an active session + a login-history entry.
  addSession(user.id, info);
  recordLogin(user.id, { device: info.device, ip: info.ip, location: info.location, success: true });
  recordAudit({
    actorId: user.id,
    actor: user.name,
    action: "auth.login_success",
    target: "登录",
    detail: `${info.device} · ${info.ip}`,
    ip: info.ip,
  });

  // Security alert: notify on login (especially useful for detecting unauthorized access)
  notify(
    user.id,
    "securityAlert",
    "检测到新登录",
    `${user.name} 在 ${info.device}（${info.browser}）上登录了账号，IP: ${info.ip}。`,
    "/settings"
  );

  const token = await createToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  const res = NextResponse.json({ user: sanitize(user), token });
  res.cookies.set("kai-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 86400,
    path: "/",
  });
  return res;
}
