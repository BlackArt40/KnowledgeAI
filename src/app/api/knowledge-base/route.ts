import { NextResponse } from "next/server";
import { listAllKbs, createKb, listDocuments } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { getUserById } from "@/lib/auth/store";

export const dynamic = "force-dynamic";

// GET /api/knowledge-base - list the user's own KBs PLUS KBs shared by
// other team members (access != "private"). Each KB includes a `shared` flag
// and `ownerName` so the UI can distinguish them.
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const kbs = listAllKbs()
    .filter((kb) => canViewKb(kb.id, kb.name, u.id, kb.ownerId))
    .map((kb) => {
      const docs = listDocuments(kb.id);
      const owner = getUserById(kb.ownerId);
      return {
        ...kb,
        shared: kb.ownerId !== u.id,
        ownerName: owner?.name ?? "未知",
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

// POST /api/knowledge-base - create a knowledge base owned by the current user
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { name?: string; desc?: string; color?: string; initial?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "知识库名称不能为空" }, { status: 400 });
  }
  const kb = createKb(
    {
      name: body.name,
      desc: body.desc ?? "",
      color: body.color,
      initial: body.initial,
    },
    u.id
  );
  return NextResponse.json({ kb }, { status: 201 });
}
