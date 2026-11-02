import { NextResponse } from "next/server";
import { getTask, deleteTask, canAccessTask } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";
import { can } from "@/lib/team/rbac";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

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

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadOwned(req, id);
  if ("error" in r) return r.error;
  return NextResponse.json({ task: r.task });
}

export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadOwned(req, id);
  if ("error" in r) return r.error;
  // Deleting someone else's research report is destructive: keep it to the task
  // owner (or a manager), not just "any member of the workspace".
  if (r.task.userId !== r.u.id && !can(r.u.role, "member.manage"))
    return NextResponse.json({ error: "权限不足：仅任务所有者或 Owner/Admin 可删除任务" }, { status: 403 });
  const ok = deleteTask(id);
  if (!ok) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
