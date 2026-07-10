// ---------------------------------------------------------------------------
// Queue - factory + public API.
//
// Selects the active JobQueue implementation:
//   - REDIS_URL set + bullmq installed -> BullMQQueue (production)
//   - otherwise -> MemoryQueue (demo / single-instance)
//
// Job handlers are registered in src/lib/queue/handlers.ts and auto-loaded.
// ---------------------------------------------------------------------------

import type { JobQueue, JobType, JobHandler } from "./interface";
import { MemoryQueue } from "./memory-queue";
import { BullMQQueue } from "./bullmq-queue";

let _instance: JobQueue | null = null;
let _handlersRegistered = false;

function getQueue(): JobQueue {
  if (_instance) return _instance;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    _instance = new BullMQQueue(redisUrl);
    console.log("[queue] Backend: BullMQ (Redis)");
  } else {
    _instance = new MemoryQueue();
    console.log("[queue] Backend: Memory (in-process)");
  }
  return _instance;
}

/** Enqueue a job. Returns a job ID. */
export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>
): Promise<string> {
  ensureHandlers();
  return getQueue().enqueue(type, payload);
}

/** Register a handler for a job type. */
export function registerHandler(type: JobType, handler: JobHandler): void {
  getQueue().registerHandler(type, handler);
}

/** Get a job's status. */
export async function getJobStatus(jobId: string) {
  return getQueue().getJob(jobId);
}

/** Start the queue worker (called on server boot). */
export function startQueue(): void {
  ensureHandlers();
  getQueue().start();
}

/** Graceful shutdown. */
export async function stopQueue(): Promise<void> {
  if (_instance) await _instance.stop();
}

/** Whether a real (Redis-backed) queue is configured. */
export function isQueueExternal(): boolean {
  return !!process.env.REDIS_URL;
}

// Auto-register handlers on first use (lazy, to avoid circular deps at import time).
function ensureHandlers(): void {
  if (_handlersRegistered) return;
  _handlersRegistered = true;
  registerDocHandler();
}

function registerDocHandler(): void {
  // Lazy import to avoid circular dependency at module load time.
  import("./handlers")
    .then(({ registerAllHandlers }) => registerAllHandlers(getQueue()))
    .catch((err) => console.error("[queue] failed to register handlers:", err));
}
