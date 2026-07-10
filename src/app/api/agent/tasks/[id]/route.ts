import { NextResponse } from "next/server";
import { getTask, deleteTask } from "@/lib/agent/store";
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
  const ok = deleteTask(id);
  if (!ok) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
