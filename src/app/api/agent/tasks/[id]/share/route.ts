import { NextResponse } from "next/server";
import {
  getTask,
  getShareConfig,
  setShareConfig,
  hashPassword,
  canAccessTask,
} from "@/lib/agent/store";
import type { SharePatch } from "@/lib/agent/store";
import type { ShareConfig } from "@/lib/agent/types";
import { getRequestUser } from "@/lib/auth/guard";
import { can } from "@/lib/team/rbac";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Never leave the server with the password hash: members (and the owner's own
 *  UI) only need to know whether a password is set. */
function publicShareConfig(cfg: ShareConfig) {
  const { passwordHash, ...rest } = cfg;
  return { ...rest, hasPassword: !!passwordHash };
}

async function loadOwned(req: Request, id: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const task = getTask(id);
  if (!task) return { error: NextResponse.json({ error: "任务不存在" }, { status: 404 }) };
  // P4-3: owner, or any member of the task's workspace.
  if (!canAccessTask(task, u))
    return { error: NextResponse.json({ error: "无权访问" }, { status: 403 }) };
  return { task, u };
}

// GET /api/agent/tasks/[id]/share - current share config
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadOwned(req, id);
  if ("error" in r) return r.error;
  return NextResponse.json({ shareConfig: publicShareConfig(getShareConfig(id)) });
}

// PUT /api/agent/tasks/[id]/share - update share permissions
// body: { enabled?, expiresAt?, password?, maxViews? } (null/0 clears optional fields)
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadOwned(req, id);
  if ("error" in r) return r.error;
  // External exposure is an owner/manager decision: a member must not be able to
  // switch off (or re-password) someone else's public report link.
  if (r.task.userId !== r.u.id && !can(r.u.role, "member.manage"))
    return NextResponse.json({ error: "权限不足：仅任务所有者或 Owner/Admin 可修改分享设置" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  const patch: SharePatch = {};
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.expiresAt !== undefined) patch.expiresAt = body.expiresAt ? Number(body.expiresAt) : null;
  if (body.password !== undefined) patch.passwordHash = body.password ? hashPassword(String(body.password)) : null;
  if (body.maxViews !== undefined) patch.maxViews = body.maxViews ? Number(body.maxViews) : null;

  const cfg = setShareConfig(id, patch);
  if (!cfg) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json({ shareConfig: publicShareConfig(cfg) });
}
