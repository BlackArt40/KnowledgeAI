import { NextResponse } from "next/server";
import { getKb, listDocuments, updateKbSettings, deleteKb, canViewDoc } from "@/lib/kb/store";
import { canViewKb, canEditKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { kbRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A KB is viewable by its owner OR by team members when shared (not private),
// and only within the SAME workspace (P4-3 tenant isolation).
async function loadAccessible(req: Request, id: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const kb = getKb(id);
  if (!kb) return { error: NextResponse.json({ error: "知识库不存在" }, { status: 404 }) };
  if (kb.workspaceId !== u.workspaceId)
    return { error: NextResponse.json({ error: "无权访问" }, { status: 403 }) };
  if (!canViewKb(kb.id, kb.name, u.id, kb.ownerId, { callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId }))
    return { error: NextResponse.json({ error: "无权访问" }, { status: 403 }) };
  // P3-3: per-KB tier (proxy can't see path params) - covers GET/PATCH/DELETE/upload.
  const rl = await kbRateLimit(id);
  if (!rl.allowed) return { error: rateLimitResponse(rl, "kb") };
  return { kb, u };
}

// GET /api/knowledge-base/[id] - kb detail + documents + aggregate stats
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadAccessible(req, id);
  if ("error" in r) return r.error;
  // Cross-process: with a separate queue worker (BullMQ), processing happens
  // in another process that persists stage/status to the DB; this process's
  // store snapshot may be stale, so reload non-terminal docs before reading.
  const { loadDocFromDb } = await import("@/lib/db/hydrate");
  const staleDocs = listDocuments(id).filter((d) =>
    ["queued", "parsing", "chunking", "vectorizing"].includes(d.status)
  );
  if (staleDocs.length > 0) {
    await Promise.allSettled(staleDocs.map((d) => loadDocFromDb(d.id)));
  }
  // P4-2: document-level permissions - hide private docs from non-owners and
  // carry each doc's access override so the UI can render per-doc controls.
  const visible = listDocuments(id).filter((d) => canViewDoc(r.kb, d, r.u.id, r.u.workspaceId));
  const docs = visible.map((d) => ({ ...d, access: d.access ?? null }));
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
// P4-1 optimistic concurrency: the client sends `baseVersion` (the version it
// last saw); a stale version returns 409 instead of silently overwriting.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadAccessible(req, id);
  if ("error" in r) return r.error;
  if (!canEditKb(r.kb.id, r.kb.name, r.u.id, r.kb.ownerId, { callerWorkspaceId: r.u.workspaceId, kbWorkspaceId: r.kb.workspaceId }))
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  let body: { baseVersion?: number } & Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const { baseVersion, ...settings } = body;
  const result = updateKbSettings(id, settings, { baseVersion, actor: r.u.name });
  if (!result) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  if (result.conflict) {
    return NextResponse.json(
      { error: "该知识库设置已被其他成员修改，请刷新后重试", currentVersion: result.kb.version },
      { status: 409 }
    );
  }
  return NextResponse.json({ kb: result.kb });
}

// DELETE /api/knowledge-base/[id] - owner only
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadAccessible(req, id);
  if ("error" in r) return r.error;
  if (r.kb.ownerId !== r.u.id)
    return NextResponse.json({ error: "仅拥有者可删除" }, { status: 403 });
  const ok = await deleteKb(id);
  if (!ok) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  recordAudit({
    actorId: r.u.id,
    actor: r.u.name,
    action: "kb.delete",
    target: r.kb.name,
    detail: `删除知识库（含全部文档）`,
  });
  return NextResponse.json({ ok: true });
}
