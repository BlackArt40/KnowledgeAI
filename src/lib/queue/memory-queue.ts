// ---------------------------------------------------------------------------
// MemoryQueue - in-process async job queue (default / demo mode).
//
// Jobs are processed sequentially with configurable concurrency.
// Suitable for single-instance deployments and development.
// No persistence - jobs are lost on process restart.
// ---------------------------------------------------------------------------

import type { JobQueue, JobType, JobHandler, JobResult } from "./interface";

interface Job {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  status: "queued" | "active" | "completed" | "failed";
  result?: JobResult;
  createdAt: number;
  attempts: number;       // attempts made so far (0 = never run)
  maxAttempts: number;    // default 3, mirrors BullMQ config
  nextRetryAt?: number;   // epoch ms; set when a failed job is waiting for backoff
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2000;

function backoffDelay(attempt: number): number {
  // Exponential: 2s, 4s, 8s, ... (mirrors BullMQ exponential backoff).
  return BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
}

export class MemoryQueue implements JobQueue {
  private jobs = new Map<string, Job>();
  private handlers = new Map<JobType, JobHandler>();
  private queue: string[] = [];
  private running = false;
  private activeCount = 0;
  private concurrency = 3;
  private jobCounter = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  async enqueue(type: JobType, payload: Record<string, unknown>): Promise<string> {
    const id = `job_${Date.now()}_${++this.jobCounter}`;
    const job: Job = {
      id,
      type,
      payload,
      status: "queued",
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this.ensureRunning();
    this.processNext();
    return id;
  }

  /**
   * Ensure the worker is running. In dev mode with HMR, instrumentation.ts's
   * start() may have targeted a previous (orphaned) instance; this guarantees
   * the current instance processes jobs regardless.
   */
  private ensureRunning(): void {
    if (!this.running) {
      this.running = true;
    }
  }

  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  async getJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return { status: job.status, result: job.result };
  }

  start(): void {
    this.running = true;
    this.processNext();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    // Wait for active jobs to finish (best-effort, max 5s)
    const deadline = Date.now() + 5000;
    while (this.activeCount > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private processNext(): void {
    if (!this.running) return;
    if (this.activeCount >= this.concurrency) return;

    const jobId = this.queue.shift();
    if (!jobId) return;

    const job = this.jobs.get(jobId);
    if (!job) return this.processNext();

    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = "failed";
      job.result = { ok: false, error: `No handler for job type: ${job.type}` };
      this.processNext();
      return;
    }

    job.status = "active";
    job.attempts += 1;
    this.activeCount++;

    handler(job.payload)
      .then((result) => {
        if (result.ok) {
          job.status = "completed";
          job.result = result;
        } else {
          this.handleFailure(job, result.error || "Job failed");
        }
      })
      .catch((err) => {
        this.handleFailure(job, err?.message ?? "Unknown error");
      })
      .finally(() => {
        this.activeCount--;
        this.processNext();
      });
  }

  /**
   * Retry with exponential backoff until maxAttempts is exhausted, then mark
   * the job as permanently failed (dead-letter equivalent).
   */
  private handleFailure(job: Job, errorMessage: string): void {
    if (job.attempts < job.maxAttempts) {
      job.status = "queued";
      job.nextRetryAt = Date.now() + backoffDelay(job.attempts);
      console.warn(
        `[queue] job ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}), retrying in ${backoffDelay(job.attempts)}ms: ${errorMessage}`
      );
      this.scheduleRetry();
    } else {
      job.status = "failed";
      job.result = { ok: false, error: errorMessage };
      console.error(
        `[queue] job ${job.id} permanently failed after ${job.attempts} attempts: ${errorMessage}`
      );
    }
  }

  /**
   * Single timer that wakes up when the next retry is due. Re-queues all jobs
   * whose nextRetryAt has passed, then reschedules if more remain.
   */
  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const tick = () => {
      this.retryTimer = null;
      const now = Date.now();
      let nextDue: number | null = null;
      for (const job of this.jobs.values()) {
        if (job.status === "queued" && job.nextRetryAt && job.nextRetryAt <= now) {
          job.nextRetryAt = undefined;
          this.queue.push(job.id);
        } else if (job.status === "queued" && job.nextRetryAt) {
          nextDue = nextDue === null ? job.nextRetryAt : Math.min(nextDue, job.nextRetryAt);
        }
      }
      this.processNext();
      if (nextDue !== null) {
        const delay = Math.max(50, nextDue - Date.now());
        this.retryTimer = setTimeout(tick, delay);
      }
    };
    const delay = Math.max(50, backoffDelay(1));
    this.retryTimer = setTimeout(tick, delay);
  }
}
