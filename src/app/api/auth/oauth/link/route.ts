// P3-2: unbind an OAuth provider from the current account.
// DELETE /api/auth/oauth/link?provider=google
// Keeps the kai-token session; refuses when it would leave the account with
// no login method (no password and no other provider). Audited as
// `auth.oauth_unlink`.
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getUserById } from "@/lib/auth/store";
import { unlinkOauthProvider } from "@/lib/auth/oauth-link";
import { recordAudit } from "@/lib/security/audit";
import { withApiTrace } from "@/lib/obs/trace";
export const dynamic = "force-dynamic";

async function handleDELETE(req: Request) {
  const guard = await requireRole(req, ["owner", "admin", "editor", "viewer"]);
  if (guard.error) return guard.error;

  const provider = new URL(req.url).searchParams.get("provider");
  if (!provider) {
    return NextResponse.json({ error: "缺少 provider 参数（google / github）" }, { status: 400 });
  }

  const user = getUserById(guard.user.id);
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  const result = await unlinkOauthProvider(user, provider);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  recordAudit({
    actorId: user.id,
    actor: user.name,
    action: "auth.oauth_unlink",
    target: provider,
    detail: "解绑社交账号",
  });
  return NextResponse.json({ ok: true, oauthLinks: result.user.oauthLinks ?? {} });
}

export async function DELETE(req: Request) {
  return withApiTrace(req, "api /api/auth/oauth/link DELETE", () => handleDELETE(req));
}
