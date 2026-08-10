import { NextResponse } from "next/server";
import { getKb, getDocument, deleteDocument } from "@/lib/kb/store";
import { canViewKb, canEditKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; docId: string }> };

// P3-4: this route previously had NO auth at all - any caller could read
// document content / delete documents. Now requires an authenticated user
// with KB view (GET) / edit (DELETE) permission.
async function loadDoc(req: Request, docId: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const doc = getDocument(docId);
  if (!doc) return { error: NextResponse.json({ error: "文档不存在" }, { status: 404 }) };
  const kb = getKb(doc.kbId);
  if (!kb) return { error: NextResponse.json({ error: "知识库不存在" }, { status: 404 }) };
  if (!canViewKb(kb.id, kb.name, u.id, kb.ownerId))
    return { error: NextResponse.json({ error: "无权访问" }, { status: 403 }) };
  return { u, doc, kb };
}

// GET /api/knowledge-base/[id]/documents/[docId] — poll a single doc's status
export async function GET(req: Request, { params }: Params) {
  const { docId } = await params;
  const r = await loadDoc(req, docId);
  if ("error" in r) return r.error;
  return NextResponse.json({ doc: r.doc });
}

// DELETE /api/knowledge-base/[id]/documents/[docId] — edit-level permission
export async function DELETE(req: Request, { params }: Params) {
  const { docId } = await params;
  const r = await loadDoc(req, docId);
  if ("error" in r) return r.error;
  if (!canEditKb(r.kb.id, r.kb.name, r.u.id, r.kb.ownerId))
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  const ok = await deleteDocument(docId);
  if (!ok) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  recordAudit({
    actorId: r.u.id,
    actor: r.u.name,
    action: "doc.delete",
    target: r.doc.name,
    detail: `删除文档（知识库：${r.kb.name}）`,
  });
  return NextResponse.json({ ok: true });
}
