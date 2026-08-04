import { NextResponse } from "next/server";
import { getTask, deleteComment } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; cid: string }> };

// DELETE /api/agent/tasks/[id]/comments/[cid] - remove a comment (owner only)
export async function DELETE(req: Request, { params }: Params) {
  const { id, cid } = await params;
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (task.userId && task.userId !== u.id)
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  const ok = deleteComment(id, cid);
  if (!ok) return NextResponse.json({ error: "评论不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
