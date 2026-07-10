import { createTask, saveTask } from "@/lib/agent/store";
import { runTask } from "@/lib/agent/orchestrator";
import { getKb } from "@/lib/kb/store";
import type { OutputFormat } from "@/lib/agent/types";
import { getRequestUser } from "@/lib/auth/guard";
import { runWithUser } from "@/lib/models/context";

export const dynamic = "force-dynamic";

// POST /api/agent/run -> text/event-stream
export async function POST(req: Request) {
  const authUser = await getRequestUser(req);
  if (!authUser) return Response.json({ error: "未登录" }, { status: 401 });

  let body: {
    topic?: string; kbId?: string; outputFormat?: OutputFormat;
    agents?: string[]; maxSteps?: number;
  };
  try { body = await req.json(); } catch {
    return Response.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.topic?.trim()) return Response.json({ error: "调研主题不能为空" }, { status: 400 });

  const kb = body.kbId ? getKb(body.kbId) : undefined;
  if (body.kbId && (!kb || kb.ownerId !== authUser.id))
    return Response.json({ error: "无权访问该知识库" }, { status: 403 });

  const task = createTask(
    {
      topic: body.topic.trim(),
      kbId: body.kbId,
      kbName: kb?.name,
      outputFormat: (body.outputFormat as OutputFormat) ?? "report",
      agents: (body.agents as never[]) ?? ["planner", "searcher", "analyzer", "writer"],
      maxSteps: body.maxSteps ?? 5,
    },
    authUser.id
  );

  const enc = new TextEncoder();

  const doAgent = () => {
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          send({ type: "init", taskId: task.id });
          await runTask(task, async (e) => {
            saveTask(task);
            if (e.type === "step" && e.step) send({ type: "step", step: e.step });
            else if (e.type === "done") send({ type: "done", task });
            else if (e.type === "error") send({ type: "error", message: e.message });
          });
          saveTask(task);
        } catch {
          send({ type: "error", message: "执行失败" });
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
    });
  };

  return runWithUser(authUser.id, doAgent);
}
