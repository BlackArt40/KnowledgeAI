// ---------------------------------------------------------------------------
// API route auth guard - role-based access control for server-side routes.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth/session";
import type { Role } from "@/lib/team/types";

/** Extract + verify the authenticated user from a Request (cookie or Bearer).
 *  Returns { id, role } or null. */
export async function getRequestUser(
  req: Request
): Promise<{ id: string; role: string } | null> {
  const cookieToken = req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("kai-token="))
    ?.split("=")[1];
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  return { id: payload.id, role: payload.role };
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
  { user: { id: string; role: string }; error: null } | { user: null; error: Response }
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
