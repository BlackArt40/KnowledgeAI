import { NextResponse } from "next/server";
import { getTask } from "@/lib/agent/store";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// GET /api/agent/public/[id] - public read-only view of a finished task's
// report (no auth required, so anyone with the share link can read it).
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "报告不存在" }, { status: 404 });
  if (task.status !== "done") return NextResponse.json({ error: "报告尚未完成" }, { status: 400 });
  return NextResponse.json({
    topic: task.topic,
    report: task.report,
    citations: task.citations,
    outputFormat: task.outputFormat,
    durationMs: task.durationMs,
    createdAt: task.createdAt,
  });
}
