import { NextResponse } from "next/server";
import { verifyEmail } from "@/lib/auth/email-verify";
import { recordAudit } from "@/lib/security/audit";
import { clientInfoFromRequest } from "@/lib/security/ua";
export const dynamic = "force-dynamic";

// POST /api/auth/verify-email { token }
// Consumes the verification token from the emailed link and marks the
// inbox verified (single-use; re-issuing supersedes any older token).
export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ error: "参数不完整" }, { status: 400 });
  }

  const result = verifyEmail(token);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const info = clientInfoFromRequest(req);
  recordAudit({
    actorId: result.userId,
    actor: result.email,
    action: "auth.email_verified",
    target: "邮箱验证",
    detail: "验证邮箱成功",
    ip: info.ip,
  });
  return NextResponse.json({ ok: true, email: result.email });
}
