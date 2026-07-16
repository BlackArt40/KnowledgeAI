import { createTask, saveTask, getTask } from "@/lib/agent/store";
import { getKb } from "@/lib/kb/store";
import type { OutputFormat } from "@/lib/agent/types";
import { getRequestUser } from "@/lib/auth/guard";
import { runWithUser } from "@/lib/models/context";
import { enqueue, subscribeAgentEvents } from "@/lib/queue";

export const dynamic = "force-dynamic";

// POST /api/agent/run -> text/event-stream
//
// Creates the task, enqueues an agent-run job, then opens an SSE stream that
// relays events from the background worker (via the agent event bus) to the
// client. The request thread is NOT blocked by runTask -- it runs in the
// queue worker. Events: init -> step* -> done|error -> (stream closes).
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

  const streamResponse = () => {
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown): boolean => {
          if (req.signal.aborted) return false;
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
            return true;
          } catch {
            return false;
          }
        };

        // Subscribe to the event bus BEFORE enqueuing so we never miss the
        // first event (avoids a race where the worker publishes before we
        // attach the listener).
        let unsubscribe: (() => void) | null = null;
        let streamClosed = false;

        const closeStream = () => {
          if (streamClosed) return;
          streamClosed = true;
          if (unsubscribe) {
            try { unsubscribe(); } catch { /* already unsubscribed */ }
          }
          try { controller.close(); } catch { /* already closed */ }
        };

        try {
          unsubscribe = await subscribeAgentEvents(task.id, (event) => {
            if (streamClosed) return;
            if (event.type === "step") {
              send({ type: "step", step: event.step });
            } else if (event.type === "done") {
              // Reload the latest task state from the store in case the
              // worker's in-memory copy has fields the event snapshot lacks.
              const latest = getTask(task.id);
              send({ type: "done", task: latest ?? event.task });
            } else if (event.type === "error") {
              send({ type: "error", message: event.message });
            } else if (event.type === "end") {
              closeStream();
            }
          });

          send({ type: "init", taskId: task.id });

          // Enqueue the background job. Worker picks it up and publishes
          // step/done/error events to the bus, which we relay above.
          await enqueue("agent-run", { taskId: task.id, userId: authUser.id });
        } catch (err) {
          console.error("[agent/run] stream error:", err);
          send({ type: "error", message: "排队或执行失败" });
          // Mark the task as failed so the UI reflects the error state.
          task.status = "failed";
          saveTask(task);
          closeStream();
        }

        // If the client disconnects, clean up the subscription.
        req.signal.addEventListener("abort", () => {
          closeStream();
        });
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
    });
  };

  return runWithUser(authUser.id, streamResponse);
}
