import { NextResponse } from "next/server";
import { verifyPreAuthToken, createToken } from "@/lib/auth/session";
import { start2FAEnrollment, verify2FAEnrollment, addSession, recordLogin, is2FAEnabled } from "@/lib/security/store";
import { renderOtpAuthQR } from "@/lib/security/qr";
import { clientInfoFromRequest } from "@/lib/security/ua";
import { notify } from "@/lib/notifications/store";

export const dynamic = "force-dynamic";

// POST /api/auth/2fa-enroll
// Forced 2FA enrollment for users whose role requires 2FA. Authenticates via a
// short-lived pre-auth token (issued by /api/auth/login) rather than a session.
//
// Body:
//   { preAuthToken, action: "enroll" }                 -> start enrollment
//   { preAuthToken, action: "verify", code: "123456" } -> activate 2FA + issue session
export async function POST(req: Request) {
  let body: { preAuthToken?: string; action?: "enroll" | "verify"; code?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const preAuth = body.preAuthToken ? await verifyPreAuthToken(body.preAuthToken) : null;
  if (!preAuth) {
    return NextResponse.json({ error: "预授权令牌无效或已过期，请重新登录" }, { status: 401 });
  }

  // A preAuthToken is for first-time forced enrollment only. Once 2FA is
  // already enabled, reject it so the token can't be replayed within its 5-min
  // validity window to overwrite the TOTP secret/backup codes or mint extra
  // sessions. Changes to an already-enabled account must go through an
  // authenticated session, not a pre-auth token.
  if (is2FAEnabled(preAuth.id)) {
    return NextResponse.json(
      { error: "两步验证已开启，无需重复绑定；如需修改请登录后在设置中操作。" },
      { status: 409 }
    );
  }

  const action = body.action || "enroll";

  switch (action) {
    case "enroll": {
      const result = start2FAEnrollment(preAuth.id, preAuth.email);
      const qr = await renderOtpAuthQR(result.qrCodeUri);
      return NextResponse.json({
        action: "enroll",
        secret: result.secret,
        qrCodeUri: result.qrCodeUri,
        qrCodeDataUrl: qr.dataUrl,
        backupCodes: result.backupCodes,
        message: "请使用验证器 App 扫描二维码，然后输入 6 位验证码完成绑定。",
      });
    }

    case "verify": {
      if (!body.code || !/^\d{6}$/.test(body.code.trim())) {
        return NextResponse.json({ error: "请输入 6 位验证码" }, { status: 400 });
      }
      const ok = verify2FAEnrollment(preAuth.id, body.code.trim());
      if (!ok) {
        return NextResponse.json({ error: "验证码不正确，请重试" }, { status: 400 });
      }
      // Enrollment complete: create the real session now.
      // P1-3: session id = JWT jti (revoking the session kills the token).
      const info = clientInfoFromRequest(req);
      const sessions = addSession(preAuth.id, info);
      recordLogin(preAuth.id, { device: info.device, ip: info.ip, location: info.location, success: true });
      notify(
        preAuth.id,
        "securityAlert",
        "两步验证已开启",
        `${preAuth.name} 已开启两步验证并完成登录，IP: ${info.ip}。`,
        "/settings"
      );
      const token = await createToken({
        id: preAuth.id,
        email: preAuth.email,
        name: preAuth.name,
        role: preAuth.role as "owner" | "admin" | "editor" | "viewer",
      }, 7 * 86400, { jti: sessions[0]?.id });
      const user = {
        id: preAuth.id,
        email: preAuth.email,
        name: preAuth.name,
        role: preAuth.role,
      };
      const res = NextResponse.json({ action: "verify", enabled: true, user, token });
      res.cookies.set("kai-token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 86400,
        path: "/",
      });
      return res;
    }

    default:
      return NextResponse.json({ error: "未知操作" }, { status: 400 });
  }
}
