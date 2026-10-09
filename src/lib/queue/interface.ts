// ---------------------------------------------------------------------------
// Job Queue Interface - abstraction over task queue backends.
//
// Implementations:
//   - MemoryQueue  (default, in-process async queue for demo / single-instance)
//   - BullMQQueue  (Redis-backed, multi-instance, retries, dead-letter queue)
//
// Selected via REDIS_URL env var: if set -> BullMQ, otherwise -> Memory.
// ---------------------------------------------------------------------------

export type JobType = "doc-process" | "agent-run" | "index-cleanup" | "webhook-deliver" | "email-send";

export interface JobData {
  type: JobType;
  payload: Record<string, unknown>;
}

export interface JobResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

export type JobHandler = (payload: Record<string, unknown>) => Promise<JobResult>;

// ── X5/X6: queue backpressure ─────────────────────────────────────────────
//
// The queues had no depth cap - an unbounded backlog could grow until the
// process was OOM-killed. enqueue() now refuses new work once a queue's
// backlog (waiting + delayed) reaches QUEUE_MAX_DEPTH, giving producers a
// clear retryable signal instead. The same cap feeds the /api/health/ready
// `queueBackpressured` flag so monitoring can alert before hits.

/** Default backlog cap per queue (waiting + delayed). */
export const QUEUE_MAX_DEPTH_DEFAULT = 500;

/** Resolve the backlog cap: QUEUE_MAX_DEPTH env override, else the default. */
export function queueMaxDepth(): number {
  const parsed = parseInt(process.env.QUEUE_MAX_DEPTH ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : QUEUE_MAX_DEPTH_DEFAULT;
}

/** Thrown by enqueue() when a queue's backlog is at (or above) the cap.
 *  Callers map it to a retryable 503-style response, or skip best-effort
 *  work (webhooks) rather than failing the user's request. */
export class QueueBackpressureError extends Error {
  readonly code = "queue_full";
  readonly depth: number;
  readonly maxDepth: number;

  constructor(depth: number, maxDepth: number) {
    super(`队列积压已达上限（${depth}/${maxDepth}），拒绝新任务`);
    this.name = "QueueBackpressureError";
    this.depth = depth;
    this.maxDepth = maxDepth;
  }
}

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

export interface QueueStats {
  name: string;
  concurrency: number;
  counts: QueueCounts;
}

export interface QueueStatsSnapshot {
  mode: "memory" | "redis";
  available: boolean;
  capturedAt: number;
  queues: QueueStats[];
  error?: string;
}

export interface JobQueue {
  /** Enqueue a job. Returns a job ID. */
  enqueue(type: JobType, payload: Record<string, unknown>): Promise<string>;

  /** Register a handler for a job type. */
  registerHandler(type: JobType, handler: JobHandler): void;

  /** Get a job's status and result (if completed). */
  getJob(jobId: string): Promise<{ status: "queued" | "active" | "completed" | "failed"; result?: JobResult } | null>;

  /** Current queue counts and configured worker concurrency. */
  getStats(): Promise<QueueStats[]>;

  /** Start processing queued jobs. */
  start(): void;

  /** Graceful shutdown. */
  stop(): Promise<void>;
}
