import { NextResponse } from "next/server";
import { getKb, getDocument, canEditDoc } from "@/lib/kb/store";
import {
  createDocShare,
  getDocShareByDoc,
  revokeDocShareByDoc,
} from "@/lib/kb/doc-share";
import { getRequestUser } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; docId: string }> };

// GET /api/knowledge-base/[id]/documents/[docId]/share
// Returns the active share link config (token + settings), if any.
export async function GET(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { docId } = await params;
  const doc = getDocument(docId);
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  const kb = getKb(doc.kbId);
  if (!kb || !canEditDoc(kb, doc, u.id))
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  const share = getDocShareByDoc(docId);
  return NextResponse.json({ share: share ? { ...share, passwordHash: undefined } : null });
}

// POST /api/knowledge-base/[id]/documents/[docId]/share
// { expiresAt?, password?, maxViews? } - create or replace the share link.
export async function POST(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { docId } = await params;
  const doc = getDocument(docId);
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  const kb = getKb(doc.kbId);
  if (!kb || !canEditDoc(kb, doc, u.id))
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });

  let body: { expiresAt?: number | null; password?: string | null; maxViews?: number | null };
  try { body = await req.json(); } catch { body = {}; }

  const share = createDocShare({
    docId,
    createdBy: u.id,
    expiresAt: body.expiresAt ?? undefined,
    password: body.password ?? undefined,
    maxViews: body.maxViews ?? undefined,
  });
  recordAudit({
    actorId: u.id,
    actor: u.name,
    action: "sharelink.create",
    target: doc.name,
    detail: `创建文档分享链接（${share.expiresAt ? "限时" : "永久"}${share.passwordHash ? " + 密码" : ""}${share.maxViews !== undefined ? `，最多 ${share.maxViews} 次` : ""}）`,
  });
  return NextResponse.json({ share }, { status: 201 });
}

// DELETE /api/knowledge-base/[id]/documents/[docId]/share - revoke the link
export async function DELETE(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { docId } = await params;
  const doc = getDocument(docId);
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  const kb = getKb(doc.kbId);
  if (!kb || !canEditDoc(kb, doc, u.id))
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  const ok = revokeDocShareByDoc(docId);
  recordAudit({
    actorId: u.id,
    actor: u.name,
    action: "sharelink.revoke",
    target: doc.name,
    detail: "撤销文档分享链接",
  });
  return NextResponse.json({ ok });
}
