import { NextResponse } from "next/server";
import { listAllKbs, createKb, listDocuments } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { getUserById } from "@/lib/auth/store";
import { requireApiKeyScope } from "@/lib/apikeys/scopes";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// Versioned public API (P7-1): /api/v1/knowledge-bases
// API-key callers must hold the kb:read / kb:write scope (403 otherwise).
// Same workspace isolation + access rules as the legacy route.

async function handleGET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const scope = await requireApiKeyScope(req, "kb:read");
  if (scope.error) return scope.error;

  const kbs = listAllKbs(u.workspaceId)
    .filter((kb) => canViewKb(kb.id, kb.name, u.id, kb.ownerId, { callerWorkspaceId: u.workspaceId, kbWorkspaceId: kb.workspaceId }))
    .map((kb) => {
      const docs = listDocuments(kb.id);
      const owner = getUserById(kb.ownerId);
      return {
        id: kb.id,
        name: kb.name,
        description: kb.desc,
        color: kb.color,
        ownerId: kb.ownerId,
        ownerName: owner?.name ?? "未知",
        shared: kb.ownerId !== u.id,
        stats: {
          total: docs.length,
          ready: docs.filter((d) => d.status === "ready").length,
          processing: docs.filter((d) =>
            ["queued", "parsing", "chunking", "vectorizing"].includes(d.status)
          ).length,
          chunks: docs.reduce((s, d) => s + d.chunks, 0),
        },
      };
    });
  return NextResponse.json({ kbs });
}

async function handlePOST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const scope = await requireApiKeyScope(req, "kb:write");
  if (scope.error) return scope.error;

  let body: { name?: string; desc?: string; color?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "知识库名称不能为空" }, { status: 400 });
  }
  const kb = createKb(
    { name: body.name, desc: body.desc ?? "", color: body.color },
    u.id,
    u.workspaceId
  );
  return NextResponse.json({ kb }, { status: 201 });
}

export async function GET(req: Request) {
  return withApiTrace(req, "api /api/v1/knowledge-bases GET", () => handleGET(req));
}
export async function POST(req: Request) {
  return withApiTrace(req, "api /api/v1/knowledge-bases POST", () => handlePOST(req));
}
