import { NextResponse } from "next/server";
import { listConversations, listAllConversations, createConversation } from "@/lib/chat/store";

export const dynamic = "force-dynamic";

// GET /api/chat/conversations?kbId=  (omit kbId to list all, most-recent first)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kbId = url.searchParams.get("kbId");
  const limit = url.searchParams.get("limit");
  if (!kbId) {
    return NextResponse.json({
      conversations: listAllConversations(limit ? parseInt(limit, 10) : undefined),
    });
  }
  return NextResponse.json({ conversations: listConversations(kbId) });
}

// POST /api/chat/conversations  { kbId, title? }
export async function POST(req: Request) {
  let body: { kbId?: string; title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.kbId) return NextResponse.json({ error: "kbId 必填" }, { status: 400 });
  const conv = createConversation(body.kbId, body.title);
  return NextResponse.json({ conversation: conv }, { status: 201 });
}
