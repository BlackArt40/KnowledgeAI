// ---------------------------------------------------------------------------
// Job Queue Interface - abstraction over task queue backends.
//
// Implementations:
//   - MemoryQueue  (default, in-process async queue for demo / single-instance)
//   - BullMQQueue  (Redis-backed, multi-instance, retries, dead-letter queue)
//
// Selected via REDIS_URL env var: if set -> BullMQ, otherwise -> Memory.
// ---------------------------------------------------------------------------

export type JobType = "doc-process" | "agent-run" | "index-cleanup";

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

export interface JobQueue {
  /** Enqueue a job. Returns a job ID. */
  enqueue(type: JobType, payload: Record<string, unknown>): Promise<string>;

  /** Register a handler for a job type. */
  registerHandler(type: JobType, handler: JobHandler): void;

  /** Get a job's status and result (if completed). */
  getJob(jobId: string): Promise<{ status: "queued" | "active" | "completed" | "failed"; result?: JobResult } | null>;

  /** Start processing queued jobs. */
  start(): void;

  /** Graceful shutdown. */
  stop(): Promise<void>;
}
