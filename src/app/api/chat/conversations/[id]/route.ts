import { NextResponse } from "next/server";
import { getConversation, deleteConversation } from "@/lib/chat/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/chat/conversations/[id]
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json({ conversation: conv });
}

// DELETE /api/chat/conversations/[id]
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const ok = deleteConversation(id);
  if (!ok) return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
