import { NextResponse } from "next/server";
import { getTask, getShareConfig, setShareConfig, hashPassword } from "@/lib/agent/store";
import type { SharePatch } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function loadOwned(req: Request, id: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const task = getTask(id);
  if (!task) return { error: NextResponse.json({ error: "任务不存在" }, { status: 404 }) };
  if (task.userId && task.userId !== u.id)
    return { error: NextResponse.json({ error: "无权访问" }, { status: 403 }) };
  return { task };
}

// GET /api/agent/tasks/[id]/share - current share config
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadOwned(req, id);
  if ("error" in r) return r.error;
  return NextResponse.json({ shareConfig: getShareConfig(id) });
}

// PUT /api/agent/tasks/[id]/share - update share permissions
// body: { enabled?, expiresAt?, password?, maxViews? } (null/0 clears optional fields)
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadOwned(req, id);
  if ("error" in r) return r.error;
  const body = await req.json().catch(() => ({}));

  const patch: SharePatch = {};
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.expiresAt !== undefined) patch.expiresAt = body.expiresAt ? Number(body.expiresAt) : null;
  if (body.password !== undefined) patch.passwordHash = body.password ? hashPassword(String(body.password)) : null;
  if (body.maxViews !== undefined) patch.maxViews = body.maxViews ? Number(body.maxViews) : null;

  const cfg = setShareConfig(id, patch);
  return NextResponse.json({ shareConfig: cfg });
}
