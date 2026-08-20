import { NextResponse } from "next/server";
import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { getGraph } from "@/lib/kg/store";
import { kbRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// GET /api/knowledge-base/[id]/graph - the KB's knowledge graph
// (entities + relations) for the graph visualization. Workspace-isolated,
// canViewKb-gated, KB-tier rate limited (mirrors /api/knowledge-base/[id]).
async function handleGET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;

  const kb = getKb(id);
  if (!kb) return NextResponse.json({ error: "知识库不存在" }, { status: 404 });
  if (kb.workspaceId !== u.workspaceId) {
    return NextResponse.json({ error: "无权访问该知识库" }, { status: 403 });
  }
  if (!canViewKb(kb.id, kb.name, u.id, kb.ownerId, { callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId })) {
    return NextResponse.json({ error: "无权访问该知识库" }, { status: 403 });
  }
  const rl = await kbRateLimit(id);
  if (!rl.allowed) return rateLimitResponse(rl, "kb");

  const graph = getGraph(id);
  return NextResponse.json({
    kb: { id: kb.id, name: kb.name },
    nodes: graph.entities.map((e) => ({
      id: e.id,
      label: e.label,
      type: e.type,
      mentions: e.mentions,
      docCount: e.docIds.length,
    })),
    edges: graph.relations.map((r) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      type: r.type,
      weight: r.weight,
    })),
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withApiTrace(req, "api /api/knowledge-base/graph", () => handleGET(req, ctx));
}

