import { NextResponse } from "next/server";
import { issueEmailVerification } from "@/lib/auth/email-verify";
import { isEmailEnabled } from "@/lib/email";
import { authLink, demoLinksAllowed, enqueueEmailSend } from "@/lib/email/deliver";
import { emailRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/security/audit";
import { clientInfoFromRequest } from "@/lib/security/ua";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/verify-email/resend { email }
// Issues a fresh verification token and re-delivers the email. Anti-
// enumeration: unknown / already-verified accounts get the same generic
// response; demo links are body-carried only outside production (same
// enumeration reasoning as forgot-password). Per-email throttle: see the
// forgot-password route - same unauthenticated mail-trigger shape.
export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }

  const throttle = await emailRateLimit("verify", email);
  if (!throttle.allowed) {
    return rateLimitResponse(throttle, "auth-email");
  }

  const info = clientInfoFromRequest(req);
  const token = issueEmailVerification(email);

  if (token) {
    recordAudit({
      actorId: null,
      actor: email,
      action: "auth.email_verify_request",
      target: "邮箱验证",
      detail: "重新发送验证邮件",
      ip: info.ip,
    });
    const url = authLink(req, "/verify-email", token);

    if (!isEmailEnabled()) {
      if (demoLinksAllowed()) {
        return NextResponse.json({ ok: true, demoVerifyUrl: url });
      }
      return NextResponse.json({ ok: true });
    }

    enqueueEmailSend({ to: email, url, kind: "verify" });
  }
  return NextResponse.json({ ok: true });
}
