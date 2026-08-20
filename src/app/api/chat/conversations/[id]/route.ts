import { NextResponse } from "next/server";
import {
  getConversation,
  deleteConversation,
  setConversationShared,
  setConversationArchived,
  setConversationTags,
} from "@/lib/chat/store";
import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A conversation is owned by its creator (per-user isolation). Shared
// conversations are additionally readable by team members who can view the KB.
// P4-3: everything is additionally scoped to the caller's workspace.
function owns(conv: { userId?: string; workspaceId: string } | undefined, uid: string, workspaceId: string) {
  return conv && conv.workspaceId === workspaceId && (!conv.userId || conv.userId === uid);
}

/** Team member with KB view permission can read a shared conversation (P4-1),
 *  within the same workspace (P4-3). */
function canReadShared(conv: { kbId: string; shared?: boolean; workspaceId: string }, uid: string, workspaceId: string): boolean {
  if (!conv.shared || conv.workspaceId !== workspaceId) return false;
  const kb = getKb(conv.kbId);
  return !!kb && canViewKb(kb.id, kb.name, uid, kb.ownerId, { callerWorkspaceId: workspaceId, kbWorkspaceId: kb.workspaceId });
}

// GET /api/chat/conversations/[id] - owner, or team members for shared ones
async function handleGET(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  if (!owns(conv, u.id, u.workspaceId) && !canReadShared(conv, u.id, u.workspaceId))
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  return NextResponse.json({ conversation: conv });
}

// PATCH /api/chat/conversations/[id] - owner only. Supports:
//   { shared: boolean }   (P4-1 team share)
//   { archived: boolean } (P5-3 archive / restore)
//   { tags: string[] }    (P5-3 tag grouping)
async function handlePATCH(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  let body: { shared?: boolean; archived?: boolean; tags?: string[] };
  try { body = await req.json(); } catch { body = {}; }
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  if (!owns(conv, u.id, u.workspaceId)) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  let updated = conv;
  if (typeof body.shared === "boolean") updated = setConversationShared(id, body.shared) ?? updated;
  if (typeof body.archived === "boolean") updated = setConversationArchived(id, body.archived) ?? updated;
  if (Array.isArray(body.tags)) updated = setConversationTags(id, body.tags) ?? updated;
  if (updated === conv && !("shared" in body) && !("archived" in body) && !("tags" in body)) {
    return NextResponse.json({ error: "缺少可更新字段（shared / archived / tags）" }, { status: 400 });
  }
  return NextResponse.json({ conversation: updated });
}

// DELETE /api/chat/conversations/[id]
async function handleDELETE(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  if (!owns(conv, u.id, u.workspaceId)) return NextResponse.json({ error: "无权访问" }, { status: 403 });
  const ok = deleteConversation(id);
  if (!ok) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// P6-1: request tracing + SLI metrics.
export async function GET(req: Request, ctx: Params) {
  return withApiTrace(req, "api /api/chat/conversations/[id] GET", () => handleGET(req, ctx));
}
export async function PATCH(req: Request, ctx: Params) {
  return withApiTrace(req, "api /api/chat/conversations/[id] PATCH", () => handlePATCH(req, ctx));
}
export async function DELETE(req: Request, ctx: Params) {
  return withApiTrace(req, "api /api/chat/conversations/[id] DELETE", () => handleDELETE(req, ctx));
}
