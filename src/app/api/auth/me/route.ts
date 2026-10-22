import { NextResponse } from "next/server";
import { getUserById, updateUser, deleteUser, sanitize, type User } from "@/lib/auth/store";
import { verifyToken, createToken } from "@/lib/auth/session";
import { listKbs, deleteKb } from "@/lib/kb/store";
import { deleteAllConversations } from "@/lib/chat/store";
import { deleteAllTasks } from "@/lib/agent/store";
import { deleteSecurityData } from "@/lib/security/store";
import { recordAudit } from "@/lib/security/audit";
import { deleteBillingData } from "@/lib/billing/store";
import { effectiveWorkspacePlan } from "@/lib/workspace/store";
import { withApiTrace } from "@/lib/obs/trace";
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
async function handleGET(req: Request) {
  const id = await authId(req);
  // Keep the response body stable for JSON-only clients while returning the
  // semantically correct status for a missing or expired session.
  if (!id) return NextResponse.json({ user: null }, { status: 401 });

  const user = getUserById(id);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  return NextResponse.json({ user: withEffectivePlan(req, user) });
}

/**
 * `plan` in API responses is the **effective** plan of the caller's current
 * workspace, not `users.plan`: multi-tenant upgrades are written to the
 * workspace (P4-3 `setWorkspacePlan`), and `users.plan` is only updated for the
 * payer (`payOrder` → `updateUserPlan`) - so the per-user column would report
 * every other member as "free".
 */
function withEffectivePlan(req: Request, user: User) {
  return { ...sanitize(user), plan: effectiveWorkspacePlan(req, user) };
}

// PATCH /api/auth/me - update profile (name) and/or password
// Body: { name?, currentPassword?, newPassword? }
async function handlePATCH(req: Request) {
  const id = await authId(req);
  if (!id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { name?: string; currentPassword?: string; newPassword?: string; locale?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  // Nothing to update
  if (body.name === undefined && !body.newPassword && body.locale === undefined) {
    return NextResponse.json({ error: "没有需要更新的字段" }, { status: 400 });
  }

  const result = await updateUser(id, {
    name: body.name,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
    locale: body.locale,
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

  // 与 GET 同口径：plan 返回工作区生效套餐，避免 PATCH 前后用户看到的套餐跳变
  const res = NextResponse.json({ user: withEffectivePlan(req, result), token });
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
async function handleDELETE(req: Request) {
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

  // GDPR：删除动作本身进审计链（在数据删除前写入，actor 信息才完整）。
  // 没有这条记录，哈希链里「账号凭空消失」且无任何痕迹。
  recordAudit({
    actorId: user.id,
    actor: user.name,
    action: "account.delete",
    target: user.email,
    detail: "用户自助删除账号",
  });

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

// P6-1: request tracing + SLI metrics.
export async function GET(req: Request) {
  return withApiTrace(req, "api /api/auth/me GET", () => handleGET(req));
}
export async function PATCH(req: Request) {
  return withApiTrace(req, "api /api/auth/me PATCH", () => handlePATCH(req));
}
export async function DELETE(req: Request) {
  return withApiTrace(req, "api /api/auth/me DELETE", () => handleDELETE(req));
}
