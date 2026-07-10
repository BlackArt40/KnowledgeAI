import { NextResponse } from "next/server";
import { verifyCredentials, sanitize } from "@/lib/auth/store";
import { createToken } from "@/lib/auth/session";
import { notify } from "@/lib/notifications/store";
import { addSession, recordLogin, is2FAEnabled, verify2FALogin } from "@/lib/security/store";
import { clientInfoFromRequest } from "@/lib/security/ua";
export const dynamic = "force-dynamic";

// POST /api/auth/login { email, password, totpCode? }
// When 2FA is enabled, first call returns { requires2FA: true }.
// Client then re-calls with totpCode to complete login.
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

  const user = verifyCredentials(email, password);
  if (!user) {
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
    // Verify TOTP or backup code
    if (!verify2FALogin(user.id, body.totpCode.trim())) {
      return NextResponse.json({ error: "两步验证码不正确" }, { status: 401 });
    }
  }

  // Record this real login: an active session + a login-history entry.
  const info = clientInfoFromRequest(req);
  addSession(user.id, info);
  recordLogin(user.id, { device: info.device, ip: info.ip, location: info.location, success: true });

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
