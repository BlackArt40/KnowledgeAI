import { NextResponse } from "next/server";
import { getTask, addComment, canAccessTask } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";
import { notifyUserId } from "@/lib/team/notify";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function loadOwned(req: Request, id: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const task = getTask(id);
  if (!task) return { error: NextResponse.json({ error: "任务不存在" }, { status: 404 }) };
  // P4-3: owner, or any member of the task's workspace.
  if (!canAccessTask(task, u))
    return { error: NextResponse.json({ error: "无权访问" }, { status: 403 }) };
  return { task, u };
}

// GET /api/agent/tasks/[id]/comments - list all comments
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadOwned(req, id);
  if ("error" in r) return r.error;
  return NextResponse.json({ comments: r.task.comments ?? [] });
}

// POST /api/agent/tasks/[id]/comments - add a comment (optionally anchored to [n] or a parent)
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const r = await loadOwned(req, id);
  if ("error" in r) return r.error;
  const body = await req.json().catch(() => ({}));
  if (typeof body.text !== "string" || !body.text.trim())
    return NextResponse.json({ error: "评论内容无效" }, { status: 400 });
  const text = body.text.trim();
  const parentId = typeof body.parentId === "string" ? body.parentId : undefined;
  const parent = parentId ? (r.task.comments ?? []).find((c) => c.id === parentId) : undefined;
  const c = addComment(id, {
    userName: r.u.name || r.u.email,
    userId: r.u.id,
    text,
    citeN: typeof body.citeN === "number" ? body.citeN : undefined,
    parentId,
  });

  // Close the collaboration loop: whoever owns the report (and, for a reply,
  // the author of the parent comment) must hear about it. Both go through the
  // teamActivity channel so they can be muted in Settings like other team events.
  const link = `/agent?task=${id}`;
  const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  const actor = r.u.name || r.u.email;
  const notified = new Set<string>([r.u.id]);
  if (r.task.userId && !notified.has(r.task.userId)) {
    notifyUserId(
      r.task.userId,
      { title: "报告有新评论", body: `${actor} 评论了「${r.task.topic}」：${preview}`, link },
      { exceptUserId: r.u.id }
    );
    notified.add(r.task.userId);
  }
  if (parent?.userId && !notified.has(parent.userId)) {
    notifyUserId(
      parent.userId,
      { title: "报告评论有新回复", body: `${actor} 回复了你在「${r.task.topic}」下的评论：${preview}`, link },
      { exceptUserId: r.u.id }
    );
  }
  return NextResponse.json({ comment: c });
}
