// ---------------------------------------------------------------------------
// API route auth guard - role-based access control for server-side routes.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth/session";
import { validateApiKey } from "@/lib/apikeys/store";
import { getUserById } from "@/lib/auth/store";
import type { Role } from "@/lib/team/types";

/** Authenticated user resolved from a request. */
export interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/** Extract + verify the authenticated user from a Request (cookie or Bearer).
 *  Returns the user (id/email/name/role) or null if not authenticated. */
export async function getRequestUser(
  req: Request
): Promise<RequestUser | null> {
  const cookieToken = req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("kai-token="))
    ?.split("=")[1];
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  // If the Bearer token looks like an API key (kai_sk_...), validate it as such
  // and resolve the key owner's identity.
  if (bearerToken && bearerToken.startsWith("kai_sk_")) {
    const apiKey = validateApiKey(bearerToken);
    if (!apiKey) return null;
    const owner = getUserById(apiKey.userId);
    if (!owner) return null;
    return {
      id: owner.id,
      email: owner.email,
      name: owner.name,
      role: owner.role,
    };
  }

  const token = cookieToken || bearerToken;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  return {
    id: payload.id,
    email: payload.email,
    name: payload.name,
    role: payload.role,
  };
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
