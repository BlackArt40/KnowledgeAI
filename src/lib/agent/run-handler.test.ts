// Regression (2026-10-09, Docker 多进程实机复现): with a separate BullMQ worker
// the web process's in-memory task copy stays at the queued snapshot - report /
// duration / versions only exist in the worker and travel in the `done` event
// payload. The SSE relay used to prefer the local copy, so the client rendered
// an empty report panel ("调研结果" never appeared) after every Docker run.
// The relay must prefer the event snapshot, with the local copy as fallback.
// Second case set (same day): the `error` frame must carry a stable `code` so
// the client can localize known failures (backpressure) and still show the raw
// message for everything else.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { bus, jobs, fail } = vi.hoisted(() => ({
  bus: { emit: null as null | ((event: unknown) => void) },
  jobs: [] as { type: string; payload: Record<string, unknown> }[],
  fail: { enqueue: null as null | Error },
}));

vi.mock("@/lib/auth/guard", () => ({
  getRequestUser: async () => ({
    id: "usr_owner",
    email: "owner@knowledgeai.dev",
    name: "Owner",
    role: "owner",
    workspaceId: "ws_default",
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  agentRateLimit: async () => ({ allowed: true }),
  rateLimitResponse: () => Response.json({ error: "rate limited" }, { status: 429 }),
}));

vi.mock("@/lib/queue", () => ({
  enqueue: async (type: string, payload: Record<string, unknown>) => {
    if (fail.enqueue) throw fail.enqueue;
    jobs.push({ type, payload });
    return "job_1";
  },
  subscribeAgentEvents: async (_taskId: string, cb: (event: unknown) => void) => {
    bus.emit = cb;
    return () => {};
  },
  QueueBackpressureError: class QueueBackpressureError extends Error {
    constructor(readonly depth = 0, readonly maxDepth = 0) {
      super(`队列积压已达上限（${depth}/${maxDepth}），拒绝新任务`);
    }
  },
}));

vi.mock("@/lib/billing/store", () => ({ recordAgentTask: () => {} }));

// The store's write-through persistence is irrelevant here (and would need a
// live database) - keep the in-memory store real, stub the DB side.
vi.mock("@/lib/db/persist", () => ({
  persistTask: async () => {},
  deleteAgentTaskFromDb: async () => {},
}));

import { handleAgentRun } from "@/lib/agent/run-handler";
import { getTask, listTasks } from "@/lib/agent/store";

function runRequest(topic: string) {
  return new Request("http://localhost/api/agent/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic, outputFormat: "report", maxSteps: 2, template: "default" }),
  });
}

interface DonePayload {
  task?: { id: string; status?: string; report?: string; durationMs?: number };
}

interface ErrorPayload {
  code?: string;
  message?: string;
}

/** Read SSE frames until a frame of `type` arrives (the relay keeps the stream
 *  open, so a fixed timeout guards against a missing event). */
async function readJsonFrame<T>(res: Response, type: "done" | "error"): Promise<T> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timeout = () => new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${type} event not received: ${buffer}`)), 3000)
  );
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout()]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frame = buffer.split("\n\n").find((f) => f.includes(`"${type}"`));
      if (frame) {
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (line) return JSON.parse(line.slice(5).trim()) as T;
      }
    }
    throw new Error(`stream closed before ${type}: ${buffer}`);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const readDonePayload = (res: Response) => readJsonFrame<DonePayload>(res, "done");

/** Wait until the SSE handler attached its bus subscription, then publish. */
async function emitOnBus(event: unknown): Promise<void> {
  await vi.waitFor(() => expect(bus.emit).not.toBeNull());
  const emit = bus.emit;
  if (!emit) throw new Error("event bus not attached");
  emit(event);
}

describe("agent run SSE 终态载荷（多进程）", () => {
  beforeEach(() => {
    bus.emit = null;
    jobs.length = 0;
    fail.enqueue = null;
  });

  it("优先推送 worker 事件快照（本地副本仍是 queued 旧版）", async () => {
    const res = await handleAgentRun(runRequest("回归：终态快照优先"));
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // The web process only has the queued snapshot it created itself.
    const taskId = jobs[0].payload.taskId as string;
    const local = getTask(taskId);
    expect(local?.status).toBe("queued");
    expect(local?.report).toBeUndefined();

    // The worker's final snapshot arrives on the bus after the run finished.
    const reading = readDonePayload(res);
    await emitOnBus({
      type: "done",
      task: { ...local, status: "done", report: "# 报告正文", durationMs: 1234 },
    });

    const payload = await reading;
    expect(payload.task?.report).toBe("# 报告正文");
    expect(payload.task?.status).toBe("done");
    expect(payload.task?.durationMs).toBe(1234);
  });

  it("事件缺少 task 时回退本地副本，不中断流", async () => {
    const res = await handleAgentRun(runRequest("回归：缺快照兜底"));

    const taskId = jobs[0].payload.taskId as string;
    const reading = readDonePayload(res);
    await emitOnBus({ type: "done" });

    const payload = await reading;
    expect(payload.task?.id).toBe(taskId);
  });

  it("入队被背压拒绝时下发可本地化的 code + 原始 message", async () => {
    const { QueueBackpressureError } = await import("@/lib/queue");
    fail.enqueue = new QueueBackpressureError(12, 12);

    const res = await handleAgentRun(runRequest("回归：队列繁忙"));
    const payload = await readJsonFrame<ErrorPayload>(res, "error");

    expect(payload.code).toBe("queue_busy");
    expect(payload.message).toContain("系统繁忙");
    expect(jobs).toHaveLength(0); // rejected before it reached the queue
    // The task is marked failed so the UI/history reflect the refusal.
    const task = listTasks("usr_owner").find((t) => t.topic === "回归：队列繁忙");
    expect(task?.status).toBe("failed");
  });

  it("非背压的入队失败使用 queue_failed", async () => {
    fail.enqueue = new Error("redis exploded");

    const res = await handleAgentRun(runRequest("回归：入队失败"));
    const payload = await readJsonFrame<ErrorPayload>(res, "error");

    expect(payload.code).toBe("queue_failed");
    expect(payload.message).toBe("排队或执行失败");
  });
});
