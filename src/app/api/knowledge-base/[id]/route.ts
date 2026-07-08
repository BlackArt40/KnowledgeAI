import { NextResponse } from "next/server";
import { getKb, listDocuments, updateKbSettings, deleteKb } from "@/lib/kb/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/knowledge-base/[id] — kb detail + documents + aggregate stats
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const kb = getKb(id);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  const docs = listDocuments(id);
  const stats = {
    total: docs.length,
    ready: docs.filter((d) => d.status === "ready").length,
    processing: docs.filter((d) =>
      ["queued", "parsing", "chunking", "vectorizing"].includes(d.status)
    ).length,
    chunks: docs.reduce((s, d) => s + d.chunks, 0),
    size: docs.reduce((s, d) => s + Math.max(0, d.size), 0),
  };
  return NextResponse.json({ kb, docs, stats });
}

// PATCH /api/knowledge-base/[id] — update settings
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const kb = updateKbSettings(id, body);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  return NextResponse.json({ kb });
}

// DELETE /api/knowledge-base/[id]
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const ok = deleteKb(id);
  if (!ok) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
