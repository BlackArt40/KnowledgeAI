import { NextResponse } from "next/server";
import { getTask, canAccessTask } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";
import { exportReport } from "@/lib/agent/export";
import type { ExportFormat } from "@/lib/agent/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const FORMATS: ExportFormat[] = ["md", "pdf", "pptx", "mindmap"];

// GET /api/agent/tasks/[id]/export?format=md|pdf|pptx|mindmap
// Criterion #1: four export formats. PDF returns inline HTML (browser print);
// md/pptx/mindmap return attachment downloads.
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  // P4-3: owner, or any member of the task's workspace.
  if (!canAccessTask(task, u))
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  if (task.status !== "done" || !task.report)
    return NextResponse.json({ error: "报告尚未完成" }, { status: 400 });

  // Next.js always hands route handlers an absolute URL, but a malformed one
  // should answer 400 rather than throw a 500 - hence the explicit parse guard.
  let format: ExportFormat = "md";
  try {
    format = (new URL(req.url).searchParams.get("format") ?? "md") as ExportFormat;
  } catch {
    return NextResponse.json({ error: "不支持的导出格式" }, { status: 400 });
  }
  if (!FORMATS.includes(format))
    return NextResponse.json({ error: "不支持的导出格式" }, { status: 400 });

  const result = exportReport(task, format);
  const isPdf = format === "pdf";
  const headers: Record<string, string> = {
    "Content-Type": result.contentType,
    "Content-Disposition": `${isPdf ? "inline" : "attachment"}; filename="${encodeURIComponent(result.filename)}"`,
  };
  if (result.content instanceof Uint8Array) {
    // SAFETY: ExportResult.content is string | Uint8Array, so this branch is a
    // real byte buffer; the cast only bridges Uint8Array<ArrayBufferLike> into
    // the BufferSource arm of BodyInit.
    return new NextResponse(result.content as unknown as BodyInit, { headers });
  }
  return new NextResponse(result.content as string, { headers });
}
