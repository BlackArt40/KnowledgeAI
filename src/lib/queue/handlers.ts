// ---------------------------------------------------------------------------
// Job Handlers - registered with the active JobQueue on first use.
//
// Handlers are lazy-loaded to avoid circular dependencies at module boot.
// Each handler receives a payload and returns a JobResult.
// ---------------------------------------------------------------------------

import type { JobQueue, JobHandler } from "./interface";
import { log } from "@/lib/obs/log";

// ── Document Processing Handler ──────────────────────────────────────────
//
// Runs the full document pipeline: parse -> chunk -> vectorize -> index.
// Replaces the in-request setTimeout simulator so the upload route returns
// immediately and processing happens in the background (in-process for
// MemoryQueue, separate worker process for BullMQ).
//
// Payload: { docId: string }

const docProcessHandler: JobHandler = async (payload) => {
  const docId = payload.docId as string;
  if (!docId) return { ok: false, error: "Missing docId" };

  const { getDocument, processDocInQueue } = await import("@/lib/kb/store");
  const { runWithTraceId } = await import("@/lib/obs/trace");
  const { recordDoc } = await import("@/lib/obs/metrics");
  const { reportError } = await import("@/lib/obs/errors");

  const doc = getDocument(docId);
  if (!doc) return { ok: false, error: `Document not found: ${docId}` };

  // P6-1: the upload route forwards its traceId so the queue stage (parse ->
  // chunk -> index) continues the same trace across the request boundary.
  const start = Date.now();
  try {
    await runWithTraceId(payload.traceId as string | undefined, "doc-process", async () => {
      await processDocInQueue(docId);
    });
    recordDoc(Date.now() - start, true);
    return { ok: true, data: { docId } };
  } catch (err) {
    recordDoc(Date.now() - start, false);
    reportError(err, { source: "queue", context: `doc-process ${docId}` });
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
};

// ── Agent Run Handler ────────────────────────────────────────────────────
//
// Runs the full 4-stage agent pipeline in the background and publishes
// progress events to the event bus. The SSE route subscribes to these
// events and relays them to the client. When REDIS_URL is set, events go
// through Redis Pub/Sub so the worker can run in a separate process.
//
// Payload: { taskId: string, userId: string }

const agentRunHandler: JobHandler = async (payload) => {
  const taskId = payload.taskId as string;
  const userId = payload.userId as string | undefined;
  if (!taskId) return { ok: false, error: "Missing taskId" };

  const { getTask, saveTask } = await import("@/lib/agent/store");
  const task = getTask(taskId);
  if (!task) return { ok: false, error: `Task not found: ${taskId}` };

  const { runTask } = await import("@/lib/agent/orchestrator");
  const { publishAgentEvent } = await import("./index");

  // The per-user model context must be re-established inside the worker
  // because AsyncLocalStorage does not cross process boundaries (BullMQ)
  // or even await boundaries of a fresh call stack.
  const { runWithUser } = await import("@/lib/models/context");
  // P6-1: tracing + SLI metrics for the background stage.
  const { runWithTraceId } = await import("@/lib/obs/trace");
  const { recordAgent } = await import("@/lib/obs/metrics");
  const { reportError } = await import("@/lib/obs/errors");

  const start = Date.now();
  let failed = false;
  try {
    // P6-1: forward the request's traceId (when present) into the worker so
    // the agent trace spans continue under the same trace id.
    await runWithTraceId(payload.traceId as string | undefined, "agent-run", async () => {
      await runWithUser(userId ?? "", async () => {
        await runTask(task, async (e) => {
          saveTask(task);
          await publishAgentEvent(taskId, e);
        });
        saveTask(task);
      });
    });
    return { ok: true, data: { taskId } };
  } catch (err) {
    failed = true;
    const message = err instanceof Error ? err.message : "Unknown error";
    reportError(err, { source: "queue", context: `agent-run ${taskId}` });
    await publishAgentEvent(taskId, { type: "error", message });
    return { ok: false, error: message };
  } finally {
    recordAgent(Date.now() - start, !failed);
    // Always signal end so the SSE consumer closes its stream, whether the
    // task succeeded, failed, or exhausted retries.
    const { publishAgentEnd } = await import("./index");
    await publishAgentEnd(taskId);
  }
};

// ── Index Cleanup Handler ────────────────────────────────────────────────
//
// Cleans up orphaned vector entries when a KB or document is deleted.
// Payload: { kbId?: string; docId?: string }

const indexCleanupHandler: JobHandler = async (payload) => {
  try {
    const { clearDoc, clearKb } = await import("@/lib/rag/vector-store");
    if (payload.docId && payload.kbId) {
      await clearDoc(payload.kbId as string, payload.docId as string);
    } else if (payload.kbId) {
      await clearKb(payload.kbId as string);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
};

/** Register all job handlers with the given queue instance. */
export function registerAllHandlers(queue: JobQueue): void {
  queue.registerHandler("doc-process", docProcessHandler);
  queue.registerHandler("agent-run", agentRunHandler);
  queue.registerHandler("index-cleanup", indexCleanupHandler);
  log.info("[queue] Handlers registered: doc-process, agent-run, index-cleanup");
}
