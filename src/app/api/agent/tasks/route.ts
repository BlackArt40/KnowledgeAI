import { NextResponse } from "next/server";
import { listTasks } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";
import { withApiTrace } from "@/lib/obs/trace";

export const dynamic = "force-dynamic";

// GET /api/agent/tasks  (?kbId= optional filter) - current user's tasks,
// scoped to the request workspace (P4-3 tenant isolation).
async function handleGET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const kbId = new URL(req.url).searchParams.get("kbId");
  // Cross-process: with a separate worker, task status is persisted to the
  // DB by the worker process - reload non-terminal tasks so this process's
  // snapshot reflects queue progress.
  const { loadTaskFromDb } = await import("@/lib/db/hydrate");
  const stale = listTasks(u.id, u.workspaceId).filter((t) =>
    ["queued", "running"].includes(t.status)
  );
  if (stale.length > 0) {
    await Promise.allSettled(stale.map((t) => loadTaskFromDb(t.id)));
  }
  const tasks = listTasks(u.id, u.workspaceId)
    .filter((t) => (kbId ? t.kbId === kbId : true))
    .map((t) => ({
      ...t,
      versions: undefined,
      comments: undefined,
      versionCount: t.versions?.length ?? 0,
      commentCount: t.comments?.length ?? 0,
    }));
  return NextResponse.json({ tasks });
}

// P6-1: request tracing + SLI metrics.
export async function GET(req: Request) {
  return withApiTrace(req, "api /api/agent/tasks GET", () => handleGET(req));
}
