// ---------------------------------------------------------------------------
// API route auth guard - role-based access control for server-side routes.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth/session";
import { validateApiKey } from "@/lib/apikeys/store";
import { getUserById } from "@/lib/auth/store";
import { resolveWorkspace } from "@/lib/workspace/store";
import type { Role } from "@/lib/team/types";

/** Authenticated user resolved from a request. */
export interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** P4-3: the tenant (workspace) this request operates in - resolved from
   *  the `kai-workspace` cookie, validated against workspace membership. */
  workspaceId: string;
}

/**
 * Shared RequestUser constructor (P7-2): builds a RequestUser from a store
 * User + optional workspace cookie. Used by the session path, the API-key
 * path AND the bot-integration path - one decision, three call sites, so
 * workspace resolution rules can't drift between them.
 */
export function requestUserFromUser(
  user: { id: string; email: string; name: string; role: string },
  workspaceCookie: string | null = null
): RequestUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    workspaceId: resolveWorkspace(user.id, user.email, workspaceCookie).id,
  };
}

function readCookie(req: Request, name: string): string | null {
  return (
    req.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${name}=`))
      ?.split("=")[1] ?? null
  );
}

/** Extract + verify the authenticated user from a Request (cookie or Bearer).
 *  Returns the user (id/email/name/role/workspaceId) or null if not
 *  authenticated. The workspace comes from the `kai-workspace` cookie; an
 *  unknown / non-member workspace falls back to the default one.
 *  `opts.allowApiKey` (default true): internal/legacy routes pass false so a
 *  kai_sk_ Bearer is NEVER accepted there (P1-6) - an API key scoped to
 *  kb:read must not reach /api/admin/* even though the key owner is admin. */
export async function getRequestUser(
  req: Request,
  opts?: { allowApiKey?: boolean }
): Promise<RequestUser | null> {
  const cookieToken = readCookie(req, "kai-token");
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  // If the Bearer token looks like an API key (kai_sk_...), validate it as such
  // and resolve the key owner's identity.
  if (opts?.allowApiKey !== false && bearerToken && bearerToken.startsWith("kai_sk_")) {
    const apiKey = validateApiKey(bearerToken);
    if (!apiKey) return null;
    const owner = getUserById(apiKey.userId);
    if (!owner) return null;
    return requestUserFromUser(owner, readCookie(req, "kai-workspace"));
  }

  const token = cookieToken || bearerToken;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  return requestUserFromUser(payload, readCookie(req, "kai-workspace"));
}

/** JWT-session-only variant for internal routes (P1-6). */
export function getRequestUserJwtOnly(req: Request): Promise<RequestUser | null> {
  return getRequestUser(req, { allowApiKey: false });
}

/** Require one of the given roles for an API route.
 *  Usage:
 *    const guard = await requireRole(req, ["owner", "admin"]);
 *    if (guard.error) return guard.error;
 *    // guard.user is authorized
 */
export async function requireRole(
  req: Request,
  roles: Role[]
): Promise<
  { user: RequestUser; error: null } | { user: null; error: Response }
> {
  const u = await getRequestUser(req);
  if (!u) {
    return {
      user: null,
      error: NextResponse.json({ error: "未登录" }, { status: 401 }),
    };
  }
  if (!roles.includes(u.role as Role)) {
    return {
      user: null,
      error: NextResponse.json({ error: "权限不足" }, { status: 403 }),
    };
  }
  return { user: u, error: null };
}

/** P1-6: role gate for internal / legacy routes that must NEVER accept API
 *  keys - only a real JWT session (cookie/Bearer JWT) satisfies it. An API
 *  key authenticates as its owner, so an admin-owned key with kb:read scope
 *  would otherwise pass requireRole and reach /api/admin/*. */
export async function requireRoleJwt(
  req: Request,
  roles: Role[]
): Promise<
  { user: RequestUser; error: null } | { user: null; error: Response }
> {
  const u = await getRequestUserJwtOnly(req);
  if (!u) {
    return {
      user: null,
      error: NextResponse.json({ error: "未登录" }, { status: 401 }),
    };
  }
  if (!roles.includes(u.role as Role)) {
    return {
      user: null,
      error: NextResponse.json({ error: "权限不足" }, { status: 403 }),
    };
  }
  return { user: u, error: null };
}
