import { NextResponse } from "next/server";
import {
  getKb,
  listDocuments,
  resetDocForReindex,
  markDocFailed,
} from "@/lib/kb/store";
import { canEditKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { enqueue } from "@/lib/queue";
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
  let queued = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    if (PROCESSING.includes(doc.status)) {
      skipped += 1;
      continue;
    }
    if (!doc.content?.trim()) {
      skipped += 1;
      continue;
    }
    if (!resetDocForReindex(doc.id)) {
      skipped += 1;
      continue;
    }
    try {
      await enqueue("doc-process", { docId: doc.id });
      queued += 1;
    } catch (err) {
      markDocFailed(doc.id, err instanceof Error ? err.message : "入队失败");
      failed += 1;
    }
  }

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
