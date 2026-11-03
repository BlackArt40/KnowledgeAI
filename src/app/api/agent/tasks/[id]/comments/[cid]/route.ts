import { NextResponse } from "next/server";
import { getTask, deleteComment, canAccessTask } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";
import { can } from "@/lib/team/rbac";
import { recordAudit } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; cid: string }> };

// DELETE /api/agent/tasks/[id]/comments/[cid] - remove a comment (owner only)
export async function DELETE(req: Request, { params }: Params) {
  const { id, cid } = await params;
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  // P4-3: owner, or any member of the task's workspace.
  if (!canAccessTask(task, u))
    return NextResponse.json({ error: "无权访问" }, { status: 403 });
  const comment = (task.comments ?? []).find((c) => c.id === cid);
  if (!comment) return NextResponse.json({ error: "评论不存在" }, { status: 404 });
  // Deleting a comment used to be "any member": only its author, the task owner,
  // or a manager may remove it.
  const isAuthor = comment.userId === u.id;
  const isTaskOwner = task.userId === u.id;
  if (!isAuthor && !isTaskOwner && !can(u.role, "member.manage"))
    return NextResponse.json({ error: "权限不足：仅评论作者、任务所有者或 Owner/Admin 可删除评论" }, { status: 403 });
  const ok = deleteComment(id, cid);
  if (!ok) return NextResponse.json({ error: "评论不存在" }, { status: 404 });
  recordAudit({
    actorId: u.id,
    actor: u.name,
    action: "agent.comment_delete",
    target: task.topic,
    detail: `删除 ${comment.userName} 的评论：${comment.text.slice(0, 60)}`,
  });
  return NextResponse.json({ ok: true });
}
