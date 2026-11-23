import { getConversation } from "@/lib/chat/store";
import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { subscribe } from "@/lib/realtime/bus";
import { createSseResponse } from "@/lib/sse-produce";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/chat/conversations/[id]/events - live message stream for SHARED
// conversations (P4-1 collaborative Q&A). Only shared conversations are
// streamable, and only by team members who can view the underlying KB.
// Events: { type: "message", message } - one per new chat message.
export async function GET(req: Request, { params }: Params) {
  const u = await getRequestUser(req);
  if (!u) return Response.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return Response.json({ error: "会话不存在" }, { status: 404 });
  if (!conv.shared) return Response.json({ error: "该会话未共享" }, { status: 403 });
  const kb = getKb(conv.kbId);
  if (!kb || !canViewKb(kb.id, kb.name, u.id, kb.ownerId, { callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId }))
    return Response.json({ error: "无权访问" }, { status: 403 });

  return createSseResponse(req, (sse) => {
    const unsubscribe = subscribe(`conv:${id}`, (event) => {
      sse.send(event);
    });
    sse.send({ type: "init", conversationId: id });
    return unsubscribe;
  });
}
