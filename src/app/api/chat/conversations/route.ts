import { NextResponse } from "next/server";
import { listConversations, listAllConversations, createConversation } from "@/lib/chat/store";
import { getRequestUser } from "@/lib/auth/guard";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// GET /api/chat/conversations?kbId=&limit=&archived=  (omit kbId to list all)
// Conversations are scoped to the current user + workspace (P4-3 tenant).
// P5-3: archived conversations are hidden by default; pass `archived=1` to
// list them (restore / review), which excludes the active ones.
async function handleGET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const url = new URL(req.url);
  const kbId = url.searchParams.get("kbId");
  const limit = url.searchParams.get("limit");
  const archivedOnly = url.searchParams.get("archived") === "1";
  const list = kbId
    ? listConversations(kbId, u.id).filter((c) => c.workspaceId === u.workspaceId)
    : listAllConversations(limit ? parseInt(limit, 10) : undefined, u.id).filter((c) => c.workspaceId === u.workspaceId);
  return NextResponse.json({
    conversations: list.filter((c) => (archivedOnly ? !!c.archived : !c.archived)),
  });
}

// POST /api/chat/conversations  { kbId, title? }
async function handlePOST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { kbId?: string; title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.kbId) return NextResponse.json({ error: "kbId 必填" }, { status: 400 });
  const conv = createConversation(body.kbId, body.title, u.id, u.workspaceId);
  return NextResponse.json({ conversation: conv }, { status: 201 });
}

// P6-1: request tracing + SLI metrics.
export async function GET(req: Request) {
  return withApiTrace(req, "api /api/chat/conversations GET", () => handleGET(req));
}
export async function POST(req: Request) {
  return withApiTrace(req, "api /api/chat/conversations POST", () => handlePOST(req));
}
