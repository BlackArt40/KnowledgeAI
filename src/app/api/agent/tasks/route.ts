import { NextResponse } from "next/server";
import { listTasks } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

// GET /api/agent/tasks  (?kbId= optional filter) - current user's tasks only
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const kbId = new URL(req.url).searchParams.get("kbId");
  const tasks = listTasks(u.id).filter((t) => (kbId ? t.kbId === kbId : true));
  return NextResponse.json({ tasks });
}
