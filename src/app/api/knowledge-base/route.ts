import { NextResponse } from "next/server";
import { listKbs, createKb, listDocuments } from "@/lib/kb/store";

export const dynamic = "force-dynamic";

// GET /api/knowledge-base — list all knowledge bases with per-KB stats
export async function GET() {
  const kbs = listKbs().map((kb) => {
    const docs = listDocuments(kb.id);
    return {
      ...kb,
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

// POST /api/knowledge-base — create a knowledge base
export async function POST(req: Request) {
  let body: { name?: string; desc?: string; color?: string; initial?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "知识库名称不能为空" }, { status: 400 });
  }
  const kb = createKb({
    name: body.name,
    desc: body.desc ?? "",
    color: body.color,
    initial: body.initial,
  });
  return NextResponse.json({ kb }, { status: 201 });
}
