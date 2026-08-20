// ---------------------------------------------------------------------------
// Shared agent-run SSE handler (used by /api/agent/run + /api/v1/agent/run).
//
// Creates the task, enqueues an agent-run job, then opens an SSE stream that
// relays events from the background worker (via the agent event bus) to the
// client. The request thread is NOT blocked by runTask -- it runs in the
// queue worker. Events: init -> step* -> done|error -> (stream closes).
// ---------------------------------------------------------------------------

import { createTask, saveTask, getTask } from "@/lib/agent/store";
import { recordAgentTask } from "@/lib/billing/store";
import { getKb } from "@/lib/kb/store";
import { canViewKb } from "@/lib/team/store";
import type { OutputFormat } from "@/lib/agent/types";
import { getRequestUser } from "@/lib/auth/guard";
import { runWithUser } from "@/lib/models/context";
import { enqueue, subscribeAgentEvents } from "@/lib/queue";
import { agentRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { reportError } from "@/lib/obs/errors";
import { log } from "@/lib/obs/log";

/** POST /api/agent/run -> text/event-stream (shared by legacy + v1 routes). */
export async function handleAgentRun(req: Request): Promise<Response> {
  const authUser = await getRequestUser(req);
  if (!authUser) return Response.json({ error: "未登录" }, { status: 401 });

  // P1-2: agent runs enqueue expensive multi-step LLM tasks. The proxy skips
  // /api/agent/run (SSE), so enforce a dedicated per-user quota here before
  // any task is created or charged - otherwise any logged-in user could
  // trigger unlimited cost DoS. Checked after auth, before body parsing /
  // task creation so rejected requests don't burn queue or metering state.
  const rl = await agentRateLimit(authUser.id);
  if (!rl.allowed) return rateLimitResponse(rl, "agent");

  let body: {
    topic?: string; kbId?: string; outputFormat?: OutputFormat;
    agents?: string[]; maxSteps?: number; template?: string;
  };
  try { body = await req.json(); } catch {
    return Response.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.topic?.trim()) return Response.json({ error: "调研主题不能为空" }, { status: 400 });

  // M-2: any team member with KB view permission (same workspace) can run an
  // Agent against a shared KB - the old owner-only check blocked members from
  // using Agent on shared knowledge bases.
  const kb = body.kbId ? getKb(body.kbId) : undefined;
  if (
    body.kbId &&
    (!kb ||
      !canViewKb(kb.id, kb.name, authUser.id, kb.ownerId, {
        callerWorkspaceId: authUser.workspaceId,
        kbWorkspaceId: kb.workspaceId,
      }))
  )
    return Response.json({ error: "无权访问该知识库" }, { status: 403 });

  const task = createTask(
    {
      topic: body.topic.trim(),
      kbId: body.kbId,
      kbName: kb?.name,
      outputFormat: (body.outputFormat as OutputFormat) ?? "report",
      agents: (body.agents as never[]) ?? ["planner", "searcher", "analyzer", "writer"],
      maxSteps: body.maxSteps ?? 5,
      template: body.template ?? "default",
    },
    authUser.id,
    authUser.workspaceId
  );
  // P4-3: meter the agent task against the workspace usage.
  recordAgentTask(authUser.workspaceId);

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
          // P6-1: forward the request's traceId so the queue stage continues
          // the same trace.
          await enqueue("agent-run", { taskId: task.id, userId: authUser.id, traceId: traceIdOf(req) });
        } catch (err) {
          log.error({ err }, "[agent/run] stream error");
          reportError(err, { source: "/api/agent/run", context: `task ${task.id}` });
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

/** P6-1: the trace id assigned by the proxy (or minted by withApiTrace). */
function traceIdOf(req: Request): string | undefined {
  return req.headers.get("x-trace-id") ?? req.headers.get("x-middleware-request-x-trace-id") ?? undefined;
}
