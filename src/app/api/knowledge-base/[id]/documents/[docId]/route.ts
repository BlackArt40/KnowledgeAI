import { NextResponse } from "next/server";
import { getDocument, deleteDocument } from "@/lib/kb/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; docId: string }> };

// GET /api/knowledge-base/[id]/documents/[docId] — poll a single doc's status
export async function GET(_req: Request, { params }: Params) {
  const { docId } = await params;
  const doc = getDocument(docId);
  if (!doc) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  return NextResponse.json({ doc });
}

// DELETE /api/knowledge-base/[id]/documents/[docId]
export async function DELETE(_req: Request, { params }: Params) {
  const { docId } = await params;
  const ok = await deleteDocument(docId);
  if (!ok) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
