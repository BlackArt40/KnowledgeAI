import { NextResponse } from "next/server";
import { getKb, getDocument, deleteDocument, canViewDoc, canEditDoc, setDocumentAccess } from "@/lib/kb/store";
import { getRequestUser } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/security/audit";
import type { DocAccess } from "@/lib/team/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; docId: string }> };

// P4-2: document-level permission checks on top of the KB checks (P3-4).
async function loadDoc(req: Request, docId: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const doc = getDocument(docId);
  if (!doc) return { error: NextResponse.json({ error: "文档不存在" }, { status: 404 }) };
  const kb = getKb(doc.kbId);
  if (!kb) return { error: NextResponse.json({ error: "知识库不存在" }, { status: 404 }) };
  if (!canViewDoc(kb, doc, u.id))
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

// PATCH /api/knowledge-base/[id]/documents/[docId] — set document-level access
// { access: "view" | "edit" | "private" | null } (P4-2, edit permission).
// null clears the override (inherit KB access). Audited via doc.access_change.
export async function PATCH(req: Request, { params }: Params) {
  const { docId } = await params;
  const r = await loadDoc(req, docId);
  if ("error" in r) return r.error;
  if (!canEditDoc(r.kb, r.doc, r.u.id))
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  let body: { access?: DocAccess | null };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (body.access !== "view" && body.access !== "edit" && body.access !== "private" && body.access !== null) {
    return NextResponse.json({ error: "access 必须是 view / edit / private / null" }, { status: 400 });
  }
  const prev = r.doc.access ?? null;
  const updated = setDocumentAccess(docId, body.access);
  if (!updated) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  recordAudit({
    actorId: r.u.id,
    actor: r.u.name,
    action: "doc.access_change",
    target: r.doc.name,
    detail: `文档权限由 ${prev ?? "继承"} 调整为 ${body.access ?? "继承"}`,
  });
  return NextResponse.json({ doc: updated });
}

// DELETE /api/knowledge-base/[id]/documents/[docId] — edit-level permission
export async function DELETE(req: Request, { params }: Params) {
  const { docId } = await params;
  const r = await loadDoc(req, docId);
  if ("error" in r) return r.error;
  if (!canEditDoc(r.kb, r.doc, r.u.id))
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
