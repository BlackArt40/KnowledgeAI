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
  // Cross-process: a separate worker's store is a boot-time snapshot - reload
  // rows the web process created after boot from the DB.
  const { loadDocFromDb } = await import("@/lib/db/hydrate");

  let doc = getDocument(docId);
  if (!doc && (await loadDocFromDb(docId))) doc = getDocument(docId);
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
  const { loadTaskFromDb } = await import("@/lib/db/hydrate");
  let task = getTask(taskId);
  if (!task && (await loadTaskFromDb(taskId))) task = getTask(taskId);
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
    // P7-1: notify webhook subscribers when the agent research completed.
    if (task.status === "done") {
      const { emitWebhookEvent } = await import("@/lib/webhooks/store");
      await emitWebhookEvent(task.workspaceId, "agent.completed", {
        taskId: task.id,
        topic: task.topic,
        kbId: task.kbId,
        kbName: task.kbName,
        status: task.status,
        outputFormat: task.outputFormat,
        durationMs: task.durationMs,
      }).catch((err) => {
        log.warn({ err }, "[queue] agent webhook emit failed");
      });
    }
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

// ── Webhook Delivery Handler ──────────────────────────────────────────────
//
// Performs ONE HTTP attempt for an outgoing webhook event (P7-1). Queue
// retries (3 attempts, exponential backoff in memory mode; BullMQ retry +
// DLQ with Redis) provide the reliability layer. A 2xx response marks the
// subscription healthy; non-2xx / network errors increment its failure count
// and set lastError (dead-letter state after retries are exhausted).
//
// Payload: { subscriptionId: string, payload: WebhookEventPayload }

const WEBHOOK_TIMEOUT_MS = 10_000;

const webhookDeliverHandler: JobHandler = async (payload) => {
  const subscriptionId = payload.subscriptionId as string;
  const eventPayload = payload.payload as { event: string; ts: number; data: Record<string, unknown> };
  if (!subscriptionId || !eventPayload) return { ok: false, error: "Missing subscriptionId/payload" };

  const { getWebhookSubscription, signWebhookPayload, recordDelivery, markDeliveryOutcome } =
    await import("@/lib/webhooks/store");
  const { loadWebhookFromDb } = await import("@/lib/db/hydrate");

  let sub = getWebhookSubscription(subscriptionId);
  if (!sub && (await loadWebhookFromDb(subscriptionId))) sub = getWebhookSubscription(subscriptionId);
  if (!sub) return { ok: false, error: `Subscription not found: ${subscriptionId}` };
  if (!sub.active) return { ok: true, data: { skipped: "inactive" } };

  const body = JSON.stringify(eventPayload);
  const start = Date.now();
  try {
    // P1-4: re-validate the target at delivery time - the subscription URL
    // was checked at creation, but DNS can be rebound / the row may predate
    // the check. Never POST to a private / loopback / link-local address.
    const { resolveSafeUrl } = await import("@/lib/security/ssrf");
    let target: URL;
    try {
      target = await resolveSafeUrl(sub.url);
    } catch {
      recordDelivery({
        subscriptionId, workspaceId: sub.workspaceId, event: eventPayload.event as never,
        status: "error", latencyMs: Date.now() - start, detail: "目标地址被禁止（内网/回环）",
      });
      markDeliveryOutcome(subscriptionId, false, "SSRF blocked");
      return { ok: false, error: "SSRF blocked" };
    }
    const signature = await signWebhookPayload(sub.secret, body);
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KAI-Event": eventPayload.event,
        "X-KAI-Signature": `sha256=${signature}`,
        "X-KAI-Delivery": `whk_${crypto.randomUUID().slice(0, 8)}`,
        "User-Agent": "KnowledgeAI-Webhook/1.0",
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    const ok = res.ok;
    recordDelivery({
      subscriptionId, workspaceId: sub.workspaceId, event: eventPayload.event as never,
      status: ok ? res.status : "error", latencyMs: Date.now() - start,
      detail: ok ? undefined : `HTTP ${res.status}`,
    });
    markDeliveryOutcome(subscriptionId, ok, ok ? undefined : `HTTP ${res.status}`);
    return ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "网络错误";
    recordDelivery({
      subscriptionId, workspaceId: sub.workspaceId, event: eventPayload.event as never,
      status: "error", latencyMs: Date.now() - start, detail,
    });
    markDeliveryOutcome(subscriptionId, false, detail);
    return { ok: false, error: detail };
  }
};

/** Register all job handlers with the given queue instance. */
export function registerAllHandlers(queue: JobQueue): void {
  queue.registerHandler("doc-process", docProcessHandler);
  queue.registerHandler("agent-run", agentRunHandler);
  queue.registerHandler("index-cleanup", indexCleanupHandler);
  queue.registerHandler("webhook-deliver", webhookDeliverHandler);
  log.info("[queue] Handlers registered: doc-process, agent-run, index-cleanup, webhook-deliver");
}
