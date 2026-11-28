// ---------------------------------------------------------------------------
// Shared agent-run SSE handler (used by /api/agent/run + /api/agent/run).
//
// Creates the task, enqueues an agent-run job, then opens an SSE stream that
// relays events from the background worker (via the agent event bus) to the
// client. The request thread is NOT blocked by runTask -- it runs in the
// queue worker. Events: init -> step* -> done|error -> (stream closes).
// ---------------------------------------------------------------------------

import { createTask, saveTask, getTask } from "@/lib/agent/store";
import { recordAgentTask } from "@/lib/billing/store";
import { getKb } from "@/lib/kb/store";
import { canAccessKb } from "@/lib/team/store";
import type { OutputFormat } from "@kai/shared/agent/types";
import { getRequestUser } from "@/lib/auth/guard";
import { can } from "@/lib/team/rbac";
import { runWithUser } from "@/lib/models/context";
import { enqueue, subscribeAgentEvents, QueueBackpressureError } from "@/lib/queue";
import { agentRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { reportError } from "@/lib/obs/errors";
import { log } from "@/lib/obs/log";
import { createSseResponse } from "@/lib/sse-produce";

/** SSE keep-alive interval; matches the split business service's 25s ping. */
const SSE_PING_INTERVAL_MS = 25_000;
const DEFAULT_STREAM_TIMEOUT_SECONDS = 300;

/** Server-side hard timeout for a run; blank/invalid falls back to 300s. */
function streamTimeoutMs(): number {
  const raw = Number(process.env.AGENT_STREAM_TIMEOUT_SECONDS);
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STREAM_TIMEOUT_SECONDS;
  return seconds * 1000;
}

/** POST /api/agent/run -> text/event-stream (JWT sessions and API keys alike). */
export async function handleAgentRun(
  req: Request,
  opts?: { allowApiKey?: boolean }
): Promise<Response> {
  const authUser = await getRequestUser(req, { allowApiKey: opts?.allowApiKey === true });
  if (!authUser) return Response.json({ error: "未登录" }, { status: 401 });
  // RBAC: agent.run is editor+ (viewer is read-only and must not trigger
  // expensive multi-step LLM pipelines).
  if (!can(authUser.role, "agent.run")) {
    return Response.json({ error: "权限不足：只读角色不能发起调研" }, { status: 403 });
  }

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
  if (body.kbId && (!kb || !canAccessKb(authUser, kb)))
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
  return runWithUser(authUser.id, () =>
    createSseResponse(
      req,
      async (sse) => {
        // Subscribe to the event bus BEFORE enqueuing so we never miss the
        // first event (avoids a race where the worker publishes before we
        // attach the listener).
        let unsubscribe: (() => void) | null = null;

        // P4-3: 只有真正进了队列的任务才计配额 —— 背压/入队失败时用户并没有
        // 消耗算力，之前在建 task 后就 +1，等于让被拒绝的请求也扣一次额度。
        let queued = false;
        try {
          unsubscribe = await subscribeAgentEvents(task.id, (event) => {
            if (sse.closed) return;
            if (event.type === "step") {
              sse.send({ type: "step", step: event.step });
            } else if (event.type === "done") {
              // Cross-process (BullMQ worker): this process's in-memory copy is
              // still the queued snapshot - report / duration / versions are
              // produced by the worker and travel only in the event payload.
              sse.send({ type: "done", task: event.task ?? getTask(task.id) });
            } else if (event.type === "error") {
              sse.send({ type: "error", message: event.message });
            } else if (event.type === "end") {
              sse.close();
            }
          });

          sse.send({ type: "init", taskId: task.id });

          // P6-1: forward the request's traceId so the queue stage continues
          // the same trace.
          await enqueue("agent-run", { taskId: task.id, userId: authUser.id, traceId: traceIdOf(req) });
          queued = true;
        } catch (err) {
          log.error({ err }, "[agent/run] stream error");
          reportError(err, { source: "/api/agent/run", context: `task ${task.id}` });
          // X5/X6: distinguish queue backpressure from a real failure so the
          // client knows it can simply retry in a moment.
          sse.send({
            type: "error",
            code: err instanceof QueueBackpressureError ? "queue_busy" : "queue_failed",
            message:
              err instanceof QueueBackpressureError
                ? "系统繁忙（任务队列已满），请稍后重试"
                : "排队或执行失败",
          });
          task.status = "failed";
          saveTask(task);
          sse.close();
        }

        if (queued) recordAgentTask(authUser.workspaceId, authUser.id);
        return unsubscribe;
      },
      {
        heartbeatMs: SSE_PING_INTERVAL_MS,
        timeoutMs: streamTimeoutMs(),
        onTimeout: (sse) => {
          // 阶段 2 收编：worker 静默时不能把连接永久挂住。超时下发
          // error(stream_timeout)+end；任务仍由 worker/队列恢复兜底。
          log.warn({ taskId: task.id }, "[agent/run] stream timeout");
          sse.send({
            type: "error",
            code: "stream_timeout",
            message: "等待超时，请稍后在任务列表查看结果",
          });
          sse.send({ type: "end" });
        },
      }
    )
  );
}

/** P6-1: the trace id assigned by the proxy (or minted by withApiTrace). */
function traceIdOf(req: Request): string | undefined {
  return req.headers.get("x-trace-id") ?? req.headers.get("x-middleware-request-x-trace-id") ?? undefined;
}
