import { NextResponse } from "next/server";
import { getTask, getVersion, restoreVersion } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; vid: string }> };

async function loadOwned(req: Request, id: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const task = getTask(id);
  if (!task) return { error: NextResponse.json({ error: "任务不存在" }, { status: 404 }) };
  if (task.userId && task.userId !== u.id)
    return { error: NextResponse.json({ error: "无权访问" }, { status: 403 }) };
  return { task, u };
}

// GET /api/agent/tasks/[id]/versions/[vid] - fetch a specific version snapshot
export async function GET(req: Request, { params }: Params) {
  const { id, vid } = await params;
  const r = await loadOwned(req, id);
  if ("error" in r) return r.error;
  const v = getVersion(id, vid);
  if (!v) return NextResponse.json({ error: "版本不存在" }, { status: 404 });
  return NextResponse.json({ version: v });
}

// POST /api/agent/tasks/[id]/versions/[vid] - restore the report to this version
export async function POST(req: Request, { params }: Params) {
  const { id, vid } = await params;
  const r = await loadOwned(req, id);
  if ("error" in r) return r.error;
  const ok = restoreVersion(id, vid, r.u.name || r.u.email);
  if (!ok) return NextResponse.json({ error: "版本不存在" }, { status: 404 });
  return NextResponse.json({ task: getTask(id) });
}
