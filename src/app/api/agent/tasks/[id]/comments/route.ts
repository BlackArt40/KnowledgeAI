import { NextResponse } from "next/server";
import { getTask, addComment } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function loadOwned(req: Request, id: string) {
  const u = await getRequestUser(req);
  if (!u) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const task = getTask(id);
  if (!task) return { error: NextResponse.json({ error: "任务不存在" }, { status: 404 }) };
  if (task.userId && task.userId !== u.id)
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
  const c = addComment(id, {
    userName: r.u.name || r.u.email,
    userId: r.u.id,
    text: body.text.trim(),
    citeN: typeof body.citeN === "number" ? body.citeN : undefined,
    parentId: typeof body.parentId === "string" ? body.parentId : undefined,
  });
  return NextResponse.json({ comment: c });
}
