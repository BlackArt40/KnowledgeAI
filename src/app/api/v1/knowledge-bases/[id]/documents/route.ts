// P7-2: versioned content-document endpoint - create a KB document directly
// from text (no multipart). Used by the VS Code extension (workspace sync)
// and the Notion/Confluence import connectors. Scope: kb:write.
import { NextResponse } from "next/server";
import { getKb, addDocument, listDocuments } from "@/lib/kb/store";
import { canEditKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { requireApiKeyScope } from "@/lib/apikeys/scopes";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

const MAX_CONTENT_CHARS = 2 * 1024 * 1024; // mirror the multipart text cap

async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const scope = await requireApiKeyScope(req, "kb:write");
  if (scope.error) return scope.error;

  const { id } = await params;
  const kb = getKb(id);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  if (!canEditKb(kb.id, kb.name, u.id, kb.ownerId)) {
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  }

  let body: { name?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  const name = body.name?.trim();
  const content = body.content ?? "";
  if (!name) return NextResponse.json({ error: "文档名不能为空" }, { status: 400 });
  if (!content.trim()) return NextResponse.json({ error: "文档内容不能为空" }, { status: 400 });
  if (content.length > MAX_CONTENT_CHARS) {
    return NextResponse.json({ error: "文档内容过大" }, { status: 413 });
  }
  // Idempotency for sync-style imports: a document with the same name in the
  // KB is a duplicate - 409 so clients (VS Code workspace sync) can skip it.
  if (listDocuments(id).some((d) => d.name === name)) {
    return NextResponse.json({ error: "同名文档已存在" }, { status: 409 });
  }

  const doc = addDocument({ kbId: id, name, size: content.length, content });
  return NextResponse.json({ doc }, { status: 201 });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiTrace(req, "api /api/v1/knowledge-bases/[id]/documents POST", () => handlePOST(req, ctx));
}
