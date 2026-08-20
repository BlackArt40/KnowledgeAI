import { NextResponse } from "next/server";
import { getConversation, setMessageFeedback } from "@/lib/chat/store";
import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; mid: string }> };

// P5-3: POST /api/chat/conversations/[id]/messages/[mid]/feedback
//   body: { value: "up" | "down", note?: string }
// Owner, or a team member who can read the shared conversation, may rate an
// assistant answer. The feedback is persisted per-message and consumed by
// /api/chat to down-weight a disliked answer's cited documents (RAG loop).
export async function POST(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, mid } = await params;

  let body: { value?: string | null; note?: string };
  try { body = await req.json(); } catch { body = {}; }
  if (body.value !== "up" && body.value !== "down" && body.value !== null) {
    return NextResponse.json({ error: "value 必填（up / down / null 清除）" }, { status: 400 });
  }

  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  const owned = conv.workspaceId === u.workspaceId && (!conv.userId || conv.userId === u.id);
  const sharedReadable = conv.shared && conv.workspaceId === u.workspaceId &&
    (() => { const kb = getKb(conv.kbId); return !!kb && canViewKb(kb.id, kb.name, u.id, kb.ownerId, { callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId }); })();
  if (!owned && !sharedReadable) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const msg = setMessageFeedback(id, mid, body.value, body.note);
  if (!msg) return NextResponse.json({ error: "消息不存在" }, { status: 404 });
  return NextResponse.json({ message: msg });
}
