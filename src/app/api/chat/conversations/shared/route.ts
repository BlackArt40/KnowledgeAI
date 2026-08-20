import { listSharedConversations } from "@/lib/chat/store";
import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getUserById } from "@/lib/auth/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

// GET /api/chat/conversations/shared - team-shared conversations (P4-1).
// Returns conversations marked shared by their owners; each carries the
// owner's display name. Only conversations whose KB the caller can view are
// included (private KBs keep their conversations private).
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return Response.json({ error: "未登录" }, { status: 401 });

  const convs = listSharedConversations().filter((c) => {
    const kb = getKb(c.kbId);
    return kb && canViewKb(kb.id, kb.name, u.id, kb.ownerId, { callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId });
  });

  return Response.json({
    conversations: convs.map((c) => {
      const owner = c.userId ? getUserById(c.userId) : null;
      return {
        id: c.id,
        kbId: c.kbId,
        title: c.title,
        updatedAt: c.updatedAt,
        shared: true,
        ownerName: owner?.name ?? "未知成员",
      };
    }),
  });
}
