import { NextResponse } from "next/server";
import {
  getKb,
  getDocument,
  canEditDoc,
  saveDocumentContent,
  resetDocForReindex,
  markDocFailed,
  MAX_DOC_CONTENT,
} from "@/lib/kb/store";
import { getRequestUser } from "@/lib/auth/guard";
import { enqueue } from "@/lib/queue";
import { recordAudit } from "@/lib/security/audit";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; docId: string }> };

// PUT /api/knowledge-base/[id]/documents/[docId]/content
// P3: in-app body edit with optimistic concurrency.
//   body: { content: string, baseVersion?: number }
//   - only doc.edit level (owner / editor / per-doc edit grant)
//   - stale baseVersion → 409 { code: "version_conflict", currentVersion }
//   - after saving, reset + enqueue the doc-process pipeline so chunks and
//     embeddings reflect the new body (same path as reindex).
async function handlePUT(req: Request, { params }: Params) {
  const { id, docId } = await params;
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const doc = getDocument(docId);
  if (!doc || doc.kbId !== id) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  const kb = getKb(doc.kbId);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  // Tenant boundary: never edit a document from another workspace.
  if (kb.workspaceId !== u.workspaceId) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }
  if (!canEditDoc(kb, doc, u.id, u.workspaceId)) {
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  }

  let body: { content?: unknown; baseVersion?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "正文不能为空" }, { status: 400 });
  }
  if (body.content.length > MAX_DOC_CONTENT) {
    return NextResponse.json(
      { error: `正文过大（上限 ${Math.floor(MAX_DOC_CONTENT / 1024)} KB）` },
      { status: 413 }
    );
  }
  const baseVersion = typeof body.baseVersion === "number" ? body.baseVersion : undefined;

  const saved = saveDocumentContent(docId, body.content, u.name || u.email, baseVersion);
  if (!saved.ok) {
    if (saved.code === "conflict") {
      return NextResponse.json(
        {
          error: "正文已被其他成员修改，请刷新后重试",
          code: "version_conflict",
          currentVersion: saved.currentVersion,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }

  // Re-chunk/re-embed in the background; a queue failure must not lose the
  // saved text (the doc is marked failed so "重建索引" can be retried).
  let queued = true;
  try {
    resetDocForReindex(docId);
    await enqueue("doc-process", { docId });
  } catch (err) {
    queued = false;
    markDocFailed(docId, err instanceof Error ? err.message : "入队失败");
  }

  recordAudit({
    actorId: u.id,
    actor: u.name,
    action: "doc.edit",
    target: doc.name,
    detail: `编辑文档正文（v${saved.doc.version}，${body.content.length} 字符，知识库：${kb.name}）`,
  });
  return NextResponse.json({
    doc: saved.doc,
    queued,
    ...(queued ? {} : { warning: "正文已保存，但索引重建排队失败，可稍后手动重建" }),
  });
}

export async function PUT(req: Request, ctx: Params) {
  return withApiTrace(req, "api /api/knowledge-base/[id]/documents/[docId]/content", () =>
    handlePUT(req, ctx)
  );
}
