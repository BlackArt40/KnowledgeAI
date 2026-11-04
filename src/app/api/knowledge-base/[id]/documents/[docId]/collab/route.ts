import { NextResponse } from "next/server";
import { getDocument, getKb, canViewDoc, canEditDoc } from "@/lib/kb/store";
import { getRequestUser } from "@/lib/auth/guard";
import { kbRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getCollabState, applyCollabUpdate } from "@/lib/collab/y-state";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; docId: string }> };

async function loadDoc(req: Request, id: string, docId: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const doc = getDocument(docId);
  if (!doc || doc.kbId !== id) {
    return { error: NextResponse.json({ error: "文档不存在" }, { status: 404 }) };
  }
  const kb = getKb(doc.kbId);
  if (!kb) return { error: NextResponse.json({ error: "知识库不存在" }, { status: 404 }) };
  if (kb.workspaceId !== u.workspaceId) {
    return { error: NextResponse.json({ error: "无权访问" }, { status: 403 }) };
  }
  const rl = await kbRateLimit(id);
  if (!rl.allowed) return { error: rateLimitResponse(rl, "kb") };
  return { u, doc, kb };
}

// GET .../collab — Yjs bootstrap: full update + state vector.
async function handleGET(req: Request, { params }: Params) {
  const { id, docId } = await params;
  const r = await loadDoc(req, id, docId);
  if ("error" in r) return r.error;
  if (!canViewDoc(r.kb, r.doc, r.u.id, r.u.workspaceId)) {
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  }
  const state = getCollabState(docId);
  if (!state) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  return NextResponse.json(state);
}

// POST .../collab { update } — merge one Yjs update and broadcast it.
async function handlePOST(req: Request, { params }: Params) {
  const { id, docId } = await params;
  const r = await loadDoc(req, id, docId);
  if ("error" in r) return r.error;
  if (!canEditDoc(r.kb, r.doc, r.u.id, r.u.workspaceId)) {
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  }
  let body: { update?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (typeof body.update !== "string" || !body.update) {
    return NextResponse.json({ error: "缺少 update" }, { status: 400 });
  }
  const result = applyCollabUpdate(docId, body.update, r.u.name || r.u.email);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }
    return NextResponse.json(
      { error: result.reason === "too_large" ? "更新过大" : "更新格式无效" },
      { status: result.reason === "too_large" ? 413 : 400 }
    );
  }
  return NextResponse.json({ ok: true, version: result.version });
}

export async function GET(req: Request, ctx: Params) {
  return withApiTrace(req, "api /api/knowledge-base/[id]/documents/[docId]/collab GET", () =>
    handleGET(req, ctx)
  );
}
export async function POST(req: Request, ctx: Params) {
  return withApiTrace(req, "api /api/knowledge-base/[id]/documents/[docId]/collab POST", () =>
    handlePOST(req, ctx)
  );
}
