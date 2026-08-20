// ---------------------------------------------------------------------------
// P3-2 OAuth bridge - mint a kai-token session after a successful Auth.js
// provider dance (login mode), or link the identity to the current user
// (bind mode, when a kai-token session is already present - settings page
// "绑定").
//
// Flow: login page button -> /api/auth/signin/{google,github}?callbackUrl=
// /api/auth/oauth/bridge -> provider authorize -> Auth.js callback ->
// redirect to this route -> resolve/link user -> kai-token cookie -> redirect
// to the requested callback (default /dashboard).
//
// 2FA note: OAuth provider MFA is trusted as the authentication factor, so
// OAuth logins skip the app-level TOTP step (and the admin forced-enrollment
// gate). See docs/设计说明.md 十五·二十一.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { createToken } from "@/lib/auth/session";
import { getAuthSecret } from "@/lib/secrets";
import { getUserById } from "@/lib/auth/store";
import { upsertOauthUser, linkOauthToUser, type OAuthProfile } from "@/lib/auth/oauth-link";
import { getRequestUser } from "@/lib/auth/guard";
import { addSession, recordLogin } from "@/lib/security/store";
import { clientInfoFromRequest } from "@/lib/security/ua";
import { recordAudit } from "@/lib/security/audit";
import { notify } from "@/lib/notifications/store";
import { log } from "@/lib/obs/log";

export const dynamic = "force-dynamic";

/** Validate the `cb` redirect target - only same-origin relative paths. */
function safeCallback(req: Request, fallback: string): string {
  const cb = new URL(req.url).searchParams.get("cb");
  if (cb && cb.startsWith("/") && !cb.startsWith("//")) return cb;
  return fallback;
}

export async function GET(req: Request) {
  // Read the Auth.js JWT (encrypted, carries the oauthProvider claims set by
  // the jwt callback) - this route is the post-dance redirect target, so the
  // authjs.session-token cookie is present here. Secret must be explicit:
  // getToken() env-inference requires AUTH_SECRET in the process env, which
  // is not guaranteed (the app falls back to the dev secret otherwise).
  const authJsToken = await getToken({
    req,
    secret: getAuthSecret("dev-secret-change-in-production"),
  });
  const info = clientInfoFromRequest(req);
  const login = () => new URL(`/login?error=oauth_failed`, req.url);

  const profile: OAuthProfile | null = authJsToken?.oauthProvider
    ? {
        provider: authJsToken.oauthProvider as OAuthProfile["provider"],
        providerUserId: authJsToken.oauthProviderId ?? "",
        email: authJsToken.email ?? "",
        name: authJsToken.name ?? "",
      }
    : null;

  if (!profile || !profile.providerUserId || !profile.email) {
    log.warn({ requestId: info.ip }, "[oauth] bridge: missing session identity");
    return NextResponse.redirect(login());
  }

  // ── Bind mode: existing kai-token session = linking from settings ───────
  const current = await getRequestUser(req);
  if (current) {
    const target = getUserById(current.id);
    if (!target) return NextResponse.redirect(login());
    const result = await linkOauthToUser(target, profile);
    if ("error" in result) {
      recordAudit({
        actorId: target.id,
        actor: target.name,
        action: "auth.oauth_link_failed",
        target: profile.provider,
        detail: result.error,
        ip: info.ip,
      });
      return NextResponse.redirect(new URL(`/login?error=oauth_link_conflict`, req.url));
    }
    recordAudit({
      actorId: target.id,
      actor: target.name,
      action: "auth.oauth_link",
      target: profile.provider,
      detail: `已绑定 ${profile.email}`,
      ip: info.ip,
    });
    log.info({ provider: profile.provider }, "[oauth] provider linked to existing user");
    return NextResponse.redirect(new URL(safeCallback(req, "/settings?tab=security"), req.url));
  }

  // ── Login mode: resolve (existing link / email match / auto-create) ─────
  const result = await upsertOauthUser(profile);
  if ("error" in result) {
    recordAudit({
      actorId: null,
      actor: profile.email,
      action: "auth.oauth_login_failed",
      target: profile.provider,
      detail: result.error,
      ip: info.ip,
    });
    return NextResponse.redirect(login());
  }
  const user = result.user;
  user.lastLoginAt = Date.now();

  // P1-3: tie the JWT's jti to the session record so revoking this session
  // from settings immediately invalidates the token.
  const sessions = addSession(user.id, info);
  recordLogin(user.id, { device: info.device, ip: info.ip, location: info.location, success: true });
  recordAudit({
    actorId: user.id,
    actor: user.name,
    action: "auth.oauth_login_success",
    target: profile.provider,
    detail: `${result.created ? "自动创建账号" : "登录"} · ${info.device} · ${info.ip}`,
    ip: info.ip,
  });
  notify(
    user.id,
    "securityAlert",
    "检测到新登录",
    `${user.name} 通过 ${profile.provider === "google" ? "Google" : "GitHub"} 登录了账号，IP: ${info.ip}。`,
    "/settings"
  );

  const token = await createToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  }, 7 * 86400, { jti: sessions[0]?.id });

  const res = NextResponse.redirect(new URL(safeCallback(req, "/dashboard"), req.url));
  res.cookies.set("kai-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 86400,
    path: "/",
  });
  return res;
}
