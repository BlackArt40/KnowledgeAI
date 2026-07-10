import { NextResponse } from "next/server";
import {
  start2FAEnrollment,
  verify2FAEnrollment,
  disable2FA,
  verify2FALogin,
} from "@/lib/security/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

// POST /api/security/2fa
// Body options:
//   { action: "enroll" }                      -> start enrollment, returns secret + QR URI + backup codes
//   { action: "verify", code: "123456" }      -> verify enrollment code, activates 2FA
//   { action: "disable", code: "123456" }     -> disable 2FA (requires valid TOTP or backup code)
//   { enable: true }                          -> legacy: start enrollment (backward compat)
//   { enable: false }                         -> legacy: disable (backward compat)
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: {
    action?: "enroll" | "verify" | "disable";
    code?: string;
    enable?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = body.action || (body.enable === true ? "enroll" : body.enable === false ? "disable" : "enroll");

  switch (action) {
    case "enroll": {
      // Start enrollment: generate TOTP secret + backup codes
      const result = start2FAEnrollment(u.id, u.email);
      return NextResponse.json({
        action: "enroll",
        secret: result.secret,
        qrCodeUri: result.qrCodeUri,
        backupCodes: result.backupCodes,
        message: "请使用验证器 App 扫描二维码，然后输入 6 位验证码完成绑定。",
      });
    }

    case "verify": {
      // Verify enrollment code and activate 2FA
      if (!body.code || !/^\d{6}$/.test(body.code.trim())) {
        return NextResponse.json({ error: "请输入 6 位验证码" }, { status: 400 });
      }
      const ok = verify2FAEnrollment(u.id, body.code.trim());
      if (!ok) {
        return NextResponse.json({ error: "验证码不正确，请重试" }, { status: 400 });
      }
      return NextResponse.json({
        action: "verify",
        enabled: true,
        message: "两步验证已成功开启。",
      });
    }

    case "disable": {
      // Disable 2FA (require verification)
      if (!body.code) {
        return NextResponse.json({ error: "关闭两步验证需要验证码" }, { status: 400 });
      }
      const ok = verify2FALogin(u.id, body.code.trim());
      if (!ok) {
        return NextResponse.json({ error: "验证码不正确" }, { status: 400 });
      }
      const tf = disable2FA(u.id);
      return NextResponse.json({
        action: "disable",
        twoFactor: tf,
        message: "两步验证已关闭。",
      });
    }

    default:
      return NextResponse.json({ error: "未知操作" }, { status: 400 });
  }
}
