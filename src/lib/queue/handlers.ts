// ---------------------------------------------------------------------------
// Job Handlers - registered with the active JobQueue on first use.
//
// Handlers are lazy-loaded to avoid circular dependencies at module boot.
// Each handler receives a payload and returns a JobResult.
// ---------------------------------------------------------------------------

import type { JobQueue, JobHandler } from "./interface";

// ── Document Processing Handler ──────────────────────────────────────────
//
// Processes a document through the pipeline: parse -> chunk -> vectorize.
// In memory mode, this runs in-process (same as the previous setTimeout
// simulator). In BullMQ mode, this runs in a separate worker process.
//
// Payload: { docId: string }

const docProcessHandler: JobHandler = async (payload) => {
  const docId = payload.docId as string;
  if (!docId) return { ok: false, error: "Missing docId" };

  try {
    // Lazy imports to avoid circular deps

    // The actual processing is still driven by kb/store.ts's startProcessing
    // for the in-memory case. This handler exists so that when a real queue
    // (BullMQ) is configured, document processing can be dispatched to a
    // separate worker instead of blocking the request thread.
    //
    // In the future, this handler will:
    //   1. Fetch the document from DB (not globalThis)
    //   2. Parse with LangChain document loaders (PDF/Word/etc.)
    //   3. Chunk with semantic splitters
    //   4. Embed + index into the vector store
    //   5. Update doc status in DB

    // For now, the in-memory startProcessing handles everything.
    // This handler is a no-op confirmation that the job was received.
    return { ok: true, data: { docId } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
};

// ── Agent Run Handler (placeholder for future BullMQ migration) ──────────
//
// When the Agent orchestrator is migrated to a background worker, this
// handler will run the full 4-stage pipeline and publish events via
// Redis Pub/Sub for SSE consumers to relay to the client.
//
// Payload: { taskId: string }

const agentRunHandler: JobHandler = async (payload) => {
  const taskId = payload.taskId as string;
  if (!taskId) return { ok: false, error: "Missing taskId" };
  // Placeholder - agent runs are currently in-process via SSE streaming.
  // Migration to queue will be done in a future iteration.
  return { ok: true, data: { taskId } };
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
  console.log("[queue] Handlers registered: doc-process, agent-run, index-cleanup");
}
