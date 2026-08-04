import { NextResponse } from "next/server";
import { getTask, editReport } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PUT /api/agent/tasks/[id]/report - edit the report body (criterion #3).
// Auto-snapshots the previous content for revision traceability.
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (task.userId && task.userId !== u.id)
    return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.report !== "string" || !body.report.trim())
    return NextResponse.json({ error: "报告内容无效" }, { status: 400 });

  const updated = editReport(id, body.report, u.name || u.email);
  return NextResponse.json({ task: updated });
}
