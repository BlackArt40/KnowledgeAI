import { NextResponse } from "next/server";
import { getConversation, deleteConversation } from "@/lib/chat/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A conversation is accessible only by its owner (per-user isolation).
function owns(conv: { userId?: string } | undefined, uid: string) {
  return conv && (!conv.userId || conv.userId === uid);
}

// GET /api/chat/conversations/[id]
export async function GET(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  if (!owns(conv, u.id)) return NextResponse.json({ error: "无权访问" }, { status: 403 });
  return NextResponse.json({ conversation: conv });
}

// DELETE /api/chat/conversations/[id]
export async function DELETE(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  if (!owns(conv, u.id)) return NextResponse.json({ error: "无权访问" }, { status: 403 });
  const ok = deleteConversation(id);
  if (!ok) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
