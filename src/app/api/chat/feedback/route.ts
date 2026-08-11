import { NextResponse } from "next/server";
import { listFeedbackMessages, getConversation } from "@/lib/chat/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

// P5-3: GET /api/chat/feedback - recent like/dislike feedback across the
// caller's conversations (workspace-scoped, P4-3), newest first. The feedback
// itself is what the RAG retrieval loop consumes (down-weighting disliked
// citations); this endpoint makes the data queryable (e.g. review / tuning).
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const limit = parseInt(new URL(req.url).searchParams.get("limit") ?? "20", 10);
  const items = listFeedbackMessages()
    .filter(({ conversationId }) => {
      const conv = getConversation(conversationId);
      return !!conv && conv.workspaceId === u.workspaceId;
    })
    .slice(0, Math.min(limit, 100))
    .map(({ conversationId, message }) => ({
      conversationId,
      messageId: message.id,
      value: message.feedback,
      note: message.feedbackNote ?? null,
      createdAt: message.feedbackAt ?? message.createdAt,
    }));
  return NextResponse.json({ feedback: items });
}
