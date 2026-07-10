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
}

export class MemoryQueue implements JobQueue {
  private jobs = new Map<string, Job>();
  private handlers = new Map<JobType, JobHandler>();
  private queue: string[] = [];
  private running = false;
  private activeCount = 0;
  private concurrency = 3;
  private jobCounter = 0;

  async enqueue(type: JobType, payload: Record<string, unknown>): Promise<string> {
    const id = `job_${Date.now()}_${++this.jobCounter}`;
    const job: Job = { id, type, payload, status: "queued", createdAt: Date.now() };
    this.jobs.set(id, job);
    this.queue.push(id);
    this.processNext();
    return id;
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
    // Wait for active jobs to finish (best-effort, max 5s)
    const deadline = Date.now() + 5000;
    while (this.activeCount > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private processNext(): void {
    if (!this.running && this.activeCount > 0) return;
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
    this.activeCount++;

    handler(job.payload)
      .then((result) => {
        job.status = result.ok ? "completed" : "failed";
        job.result = result;
      })
      .catch((err) => {
        job.status = "failed";
        job.result = { ok: false, error: err?.message ?? "Unknown error" };
      })
      .finally(() => {
        this.activeCount--;
        this.processNext();
      });
  }
}
