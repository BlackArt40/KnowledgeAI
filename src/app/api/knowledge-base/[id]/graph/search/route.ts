import { NextResponse } from "next/server";
import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { searchEntities } from "@/lib/kg/store";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// GET /api/knowledge-base/[id]/graph/search?q= - entity search within the KB
// graph (used by the GraphRAG debug panel + graph page search box).
async function handleGET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;

  const kb = getKb(id);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  if (kb.workspaceId !== u.workspaceId || !canViewKb(kb.id, kb.name, u.id, kb.ownerId, { callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId })) {
    return NextResponse.json({ error: "无权访问该知识库" }, { status: 403 });
  }
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ entities: searchEntities(id, q) });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiTrace(req, "api /api/knowledge-base/graph/search", () => handleGET(req, ctx));
}
