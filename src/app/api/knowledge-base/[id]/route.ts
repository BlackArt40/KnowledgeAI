import { NextResponse } from "next/server";
import { getKb, listDocuments, updateKbSettings, deleteKb } from "@/lib/kb/store";
import { canViewKb, canEditKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A KB is viewable by its owner OR by team members when shared (not private).
async function loadAccessible(req: Request, id: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const kb = getKb(id);
  if (!kb) return { error: NextResponse.json({ error: "知识库不存在" }, { status: 404 }) };
  if (!canViewKb(kb.id, kb.name, u.id, kb.ownerId))
    return { error: NextResponse.json({ error: "无权访问" }, { status: 403 }) };
  return { kb, u };
}

// GET /api/knowledge-base/[id] - kb detail + documents + aggregate stats
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadAccessible(req, id);
  if ("error" in r) return r.error;
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
  return NextResponse.json({ kb: r.kb, docs, stats });
}

// PATCH /api/knowledge-base/[id] - update settings (owner or edit-level share)
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadAccessible(req, id);
  if ("error" in r) return r.error;
  if (!canEditKb(r.kb.id, r.kb.name, r.u.id, r.kb.ownerId))
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
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

// DELETE /api/knowledge-base/[id] - owner only
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadAccessible(req, id);
  if ("error" in r) return r.error;
  if (r.kb.ownerId !== r.u.id)
    return NextResponse.json({ error: "仅拥有者可删除" }, { status: 403 });
  const ok = deleteKb(id);
  if (!ok) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
