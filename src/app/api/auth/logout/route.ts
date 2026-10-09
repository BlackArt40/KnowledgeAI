import { NextResponse } from "next/server";
import { revokeJti, verifyTokenClaims } from "@/lib/auth/session";
import { getUserById } from "@/lib/auth/store";
import { revokeSession } from "@/lib/security/store";
import { recordAudit } from "@/lib/security/audit";
export const dynamic = "force-dynamic";

/** Extract the JWT from cookie (kai-token) or Authorization: Bearer header. */
function extractToken(req: Request): string | null {
  const cookieToken = req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("kai-token="))
    ?.split("=")[1];
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return cookieToken || bearerToken;
}

// POST /api/auth/logout - end the current session for real.
//
// The session cookie is httpOnly, so the client cannot clear it with
// document.cookie: "退出登录" used to only drop the localStorage copy and
// navigate, leaving the 7-day JWT valid server-side (and, once /login started
// bouncing signed-in visitors, that bounce sent the user straight back into
// the workspace). Logout must therefore go through the server.
//
// Order matters: blacklist the jti first (works even when this instance holds
// no session record - e.g. right after a restart), then drop the record.
async function handlePOST(req: Request) {
  const token = extractToken(req);
  const claims = token ? await verifyTokenClaims(token) : null;

  if (claims) {
    if (claims.jti) {
      revokeJti(claims.jti);
      revokeSession(claims.id, claims.jti);
    }
    const user = getUserById(claims.id);
    recordAudit({
      actorId: claims.id,
      actor: user?.name ?? claims.name,
      action: "auth.logout",
      target: "登出",
      detail: "用户主动退出登录",
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
  }

  // Idempotent: without a (valid) session there is nothing to revoke, but the
  // stale cookie still has to go.
  const res = NextResponse.json({ ok: true });
  // Same attributes as the login route - a deletion cookie must match the
  // original name + path (the rest is echoed for consistency).
  res.cookies.set("kai-token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}

export async function POST(req: Request) {
  return handlePOST(req);
}
