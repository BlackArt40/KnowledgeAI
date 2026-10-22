import { NextResponse } from "next/server";
import {
  getKb,
  listDocuments,
  resetDocsForReindex,
  markDocFailed,
} from "@/lib/kb/store";
import { canEditKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { enqueueBulk } from "@/lib/queue";
import { recordAudit } from "@/lib/security/audit";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const PROCESSING = ["queued", "parsing", "chunking", "vectorizing"];

// POST /api/knowledge-base/[id]/reindex —— 整库重建索引（edit 权限）
//
// 典型场景：向量后端故障期间入库的文档（正文在、向量缺失）在修好基础设施后
// 一次性补齐；或更换 embedding 模型后整体重算。逐篇复位 + 入队 doc-process，
// 已在处理中的文档跳过（避免重复任务），没有正文的文档跳过并在响应里计数。
async function handlePOST(req: Request, { params }: Params) {
  const { id } = await params;
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const kb = getKb(id);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  if (kb.workspaceId && u.workspaceId && kb.workspaceId !== u.workspaceId) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }
  if (
    !canEditKb(id, kb.name, u.id, kb.ownerId, {
      callerWorkspaceId: u.workspaceId,
      kbWorkspaceId: kb.workspaceId,
    })
  ) {
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  }

  const docs = listDocuments(id);
  const eligible = docs.filter(
    (d) => !PROCESSING.includes(d.status) && !!d.content?.trim()
  );
  const skipped = docs.length - eligible.length;

  // 先复位（queued/进度/切片数清零），再一次性批量入队 —— 复位是同步内存写，
  // 入队走 enqueueBulk（BullMQ 单次 addBulk，避免逐篇 Redis 往返）
  const payloads = eligible.map((d) => ({ docId: d.id }));
  resetDocsForReindex(payloads.map((p) => p.docId));

  const { ids, failures } = await enqueueBulk("doc-process", payloads);
  for (const f of failures) {
    const docId = payloads[f.index]?.docId;
    if (docId) markDocFailed(docId, f.error);
  }
  const queued = ids.length;
  const failed = failures.length;

  if (queued > 0) {
    recordAudit({
      actorId: u.id,
      actor: u.name,
      action: "kb.reindex",
      target: kb.name,
      detail: `重建索引 ${queued} 篇（跳过 ${skipped}，失败 ${failed}）`,
    });
  }

  return NextResponse.json({ queued, skipped, failed, total: docs.length });
}

export async function POST(req: Request, ctx: Params) {
  return withApiTrace(req, "api /api/knowledge-base/[id]/reindex", () => handlePOST(req, ctx));
}
