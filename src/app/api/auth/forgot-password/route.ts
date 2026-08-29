import { NextResponse } from "next/server";
import { issuePasswordReset } from "@/lib/auth/password-reset";
import { isEmailEnabled } from "@/lib/email";
import { authLink, demoLinksAllowed, enqueueEmailSend } from "@/lib/email/deliver";
import { emailRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/security/audit";
import { clientInfoFromRequest } from "@/lib/security/ua";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/forgot-password { email }
// Starts a password reset: issues a single-use token (30 min) and delivers
// it by email. Anti-enumeration: the response is identical whether or not
// the account exists.
//   - Mailer configured: enqueues an `email-send` job (fire-and-forget - the
//     queue retries transient failures with exponential backoff).
//   - Mailer unconfigured OUTSIDE production: the response body carries the
//     reset link so the flow stays testable without an email account. In
//     production the uniform response is kept (returning the link only for
//     existing accounts would be an enumeration oracle) - configure a mailer.
// Per-email throttle (auth-email dimension): the endpoint is unauthenticated
// and triggers an outbound email, so the IP tiers alone don't stop someone
// mail-bombing one inbox from many addresses.
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

  const throttle = await emailRateLimit("reset", email);
  if (!throttle.allowed) {
    return rateLimitResponse(throttle, "auth-email");
  }

  const info = clientInfoFromRequest(req);
  const token = issuePasswordReset(email);

  if (token) {
    recordAudit({
      actorId: null,
      actor: email,
      action: "auth.password_reset_request",
      target: "密码重置",
      detail: "申请重置密码",
      ip: info.ip,
    });
    const url = authLink(req, "/reset-password", token);

    if (!isEmailEnabled()) {
      if (demoLinksAllowed()) {
        // Demo fallback: no mailer and not a production build - expose the
        // link directly so local flows stay testable.
        return NextResponse.json({ ok: true, demoResetUrl: url });
      }
      return NextResponse.json({ ok: true });
    }

    enqueueEmailSend({ to: email, url, kind: "reset" });
  }
  return NextResponse.json({ ok: true });
}
