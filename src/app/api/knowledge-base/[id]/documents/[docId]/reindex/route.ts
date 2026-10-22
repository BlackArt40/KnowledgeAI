import { NextResponse } from "next/server";
import {
  getKb,
  getDocument,
  canEditDoc,
  resetDocForReindex,
  markDocFailed,
} from "@/lib/kb/store";
import { getRequestUser } from "@/lib/auth/guard";
import { enqueue } from "@/lib/queue";
import { recordAudit } from "@/lib/security/audit";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; docId: string }> };

// POST /api/knowledge-base/[id]/documents/[docId]/reindex
//
// 重新切片 + 重嵌入单个文档（edit 权限）。用于：基础设施故障期间文档正文已
// 落库但向量缺失（如 pgvector 扩展未安装）、或换了 embedding 模型后需要
// 重建索引。正文不在库里的文档（例如早期只存了文件）返回 422，请重新上传。
async function handlePOST(req: Request, { params }: Params) {
  const { docId } = await params;
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const doc = getDocument(docId);
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  const kb = getKb(doc.kbId);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  // 租户边界：KB 必须属于调用者当前工作区，否则跨租户可重建他人索引
  if (kb.workspaceId && u.workspaceId && kb.workspaceId !== u.workspaceId) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }
  if (!canEditDoc(kb, doc, u.id, u.workspaceId)) {
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  }
  if (!doc.content?.trim()) {
    return NextResponse.json(
      { error: "该文档没有可用正文，请重新上传后再试" },
      { status: 422 }
    );
  }
  if (["queued", "parsing", "chunking", "vectorizing"].includes(doc.status)) {
    return NextResponse.json({ error: "文档正在处理中，请稍后再试" }, { status: 409 });
  }

  const reset = resetDocForReindex(docId);
  if (!reset) return NextResponse.json({ error: "文档不存在" }, { status: 404 });

  try {
    await enqueue("doc-process", { docId });
  } catch (err) {
    // 入队失败（背压/队列不可用）：标记 error，避免文档卡在 queued 无限转圈
    markDocFailed(docId, err instanceof Error ? err.message : "入队失败");
    return NextResponse.json({ error: "任务队列繁忙，请稍后重试" }, { status: 503 });
  }

  recordAudit({
    actorId: u.id,
    actor: u.name,
    action: "doc.reindex",
    target: doc.name,
    detail: `重建文档索引（知识库：${kb.name}）`,
  });
  return NextResponse.json({ doc: reset, queued: true });
}

export async function POST(req: Request, ctx: Params) {
  return withApiTrace(req, "api /api/knowledge-base/[id]/documents/[docId]/reindex", () =>
    handlePOST(req, ctx)
  );
}
