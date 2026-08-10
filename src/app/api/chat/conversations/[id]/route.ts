import { NextResponse } from "next/server";
import { getConversation, deleteConversation, setConversationShared } from "@/lib/chat/store";
import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A conversation is owned by its creator (per-user isolation). Shared
// conversations are additionally readable by team members who can view the KB.
function owns(conv: { userId?: string } | undefined, uid: string) {
  return conv && (!conv.userId || conv.userId === uid);
}

/** Team member with KB view permission can read a shared conversation (P4-1). */
function canReadShared(conv: { kbId: string; shared?: boolean }, uid: string): boolean {
  if (!conv.shared) return false;
  const kb = getKb(conv.kbId);
  return !!kb && canViewKb(kb.id, kb.name, uid, kb.ownerId);
}

// GET /api/chat/conversations/[id] - owner, or team members for shared ones
export async function GET(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  if (!owns(conv, u.id) && !canReadShared(conv, u.id))
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  return NextResponse.json({ conversation: conv });
}

// PATCH /api/chat/conversations/[id] - { shared: boolean } (owner only, P4-1)
export async function PATCH(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  let body: { shared?: boolean };
  try { body = await req.json(); } catch { body = {}; }
  if (typeof body.shared !== "boolean") {
    return NextResponse.json({ error: "shared 必填（布尔值）" }, { status: 400 });
  }
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  if (!owns(conv, u.id)) return NextResponse.json({ error: "无权访问" }, { status: 403 });
  const updated = setConversationShared(id, body.shared);
  return NextResponse.json({ conversation: updated });
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
