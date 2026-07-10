import { NextResponse } from "next/server";
import { getUserById, updateUser, deleteUser, sanitize } from "@/lib/auth/store";
import { verifyToken, createToken } from "@/lib/auth/session";
import { listKbs, deleteKb } from "@/lib/kb/store";
import { deleteAllConversations } from "@/lib/chat/store";
import { deleteAllTasks } from "@/lib/agent/store";
import { deleteSecurityData } from "@/lib/security/store";
import { deleteBillingData } from "@/lib/billing/store";
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

/** Resolve the authenticated user id from a request, or null. */
async function authId(req: Request): Promise<string | null> {
  const token = extractToken(req);
  if (!token) return null;
  const payload = await verifyToken(token);
  return payload?.id ?? null;
}

// GET /api/auth/me - get current user from cookie or Authorization header
export async function GET(req: Request) {
  const id = await authId(req);
  if (!id) return NextResponse.json({ user: null }, { status: 200 });

  const user = getUserById(id);
  if (!user) return NextResponse.json({ user: null }, { status: 200 });

  return NextResponse.json({ user: sanitize(user) });
}

// PATCH /api/auth/me - update profile (name) and/or password
// Body: { name?, currentPassword?, newPassword? }
export async function PATCH(req: Request) {
  const id = await authId(req);
  if (!id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { name?: string; currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  // Nothing to update
  if (body.name === undefined && !body.newPassword) {
    return NextResponse.json({ error: "没有需要更新的字段" }, { status: 400 });
  }

  const result = updateUser(id, {
    name: body.name,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Re-issue JWT so the token carries the updated name
  const token = await createToken({
    id: result.id,
    email: result.email,
    name: result.name,
    role: result.role,
  });

  const res = NextResponse.json({ user: sanitize(result), token });
  res.cookies.set("kai-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 86400,
    path: "/",
  });
  return res;
}


// DELETE /api/auth/me - permanently delete the current user's account and all
// associated data (KBs, conversations, agent tasks, security, billing).
export async function DELETE(req: Request) {
  const id = await authId(req);
  if (!id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const user = getUserById(id);
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  // Prevent the only owner from deleting their account (team would be
  // left ownerless). In a real app this would check for other owners.
  if (user.role === "owner") {
    return NextResponse.json(
      { error: "Owner 账户不可删除，请先转移所有权" },
      { status: 403 }
    );
  }

  // Delete all user data across stores.
  for (const kb of listKbs(id)) await deleteKb(kb.id);
  deleteAllConversations(id);
  deleteAllTasks(id);
  deleteSecurityData(id);
  deleteBillingData(id);
  deleteUser(id);

  const res = NextResponse.json({ ok: true });
  res.cookies.set("kai-token", "", { httpOnly: true, maxAge: 0, path: "/" });
  return res;
}
