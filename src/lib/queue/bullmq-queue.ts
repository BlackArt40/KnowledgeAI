// ---------------------------------------------------------------------------
// BullMQQueue - Redis-backed job queue for production multi-instance deploys.
//
// Requires:
//   1. REDIS_URL env var (e.g. redis://localhost:6379)
//   2. bullmq package installed (pnpm add bullmq ioredis)
//
// Features: persistence, retries, exponential backoff, dead-letter queue,
// concurrency control, event pub/sub for real-time progress.
// ---------------------------------------------------------------------------

import type { JobQueue, JobType, JobHandler, JobResult } from "./interface";
import { log } from "@/lib/obs/log";

// BullMQ types (dynamic import - not installed in demo mode)
interface BullMQJobType {
  id: string;
  data: { type: JobType; payload: Record<string, unknown> };
  updateProgress(p: number): void;
  returnvalue: unknown;
}
interface BullMQQueueType {
  add(name: string, data: unknown, opts?: unknown): Promise<BullMQJobType>;
  getJob(id: string): Promise<BullMQJobType | null>;
  close(): Promise<void>;
}
interface BullMQWorkerType {
  close(): Promise<void>;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

type QueueModule = {
  Queue: new (name: string, opts: unknown) => BullMQQueueType;
  Worker: new (name: string, processor: (job: BullMQJobType) => Promise<unknown>, opts: unknown) => BullMQWorkerType;
};

const QUEUE_NAME = "knowledgeai-jobs";

export class BullMQQueue implements JobQueue {
  private queue: BullMQQueueType | null = null;
  private worker: BullMQWorkerType | null = null;
  private handlers = new Map<JobType, JobHandler>();
  private mod: QueueModule | null = null;
  /** L-9: parsed once in ensureConnected(), reused by start() - was recomputed
   *  in two places and a third dead `this.connection` field stored the raw
   *  URL but was never read. */
  private parsedConnection: Record<string, unknown> | null = null;

  constructor(_redisUrl: string) {
    // L-9: the raw URL was stored but never used (ensureConnected parses
    // REDIS_URL directly); parameter kept for API stability.
  }

  private async ensureConnected(): Promise<QueueModule> {
    if (this.mod && this.queue) return this.mod;
    try {
      const bullmq = await import("bullmq");
      this.mod = bullmq as unknown as QueueModule;
      this.parsedConnection = this.parseRedisUrl(process.env.REDIS_URL!);
      this.queue = new this.mod.Queue(QUEUE_NAME, { connection: this.parsedConnection });
      return this.mod;
    } catch {
      throw new Error("bullmq not installed - run: pnpm add bullmq ioredis");
    }
  }

  private parseRedisUrl(url: string): Record<string, unknown> {
    try {
      const u = new URL(url);
      return {
        host: u.hostname,
        port: parseInt(u.port || "6379", 10),
        password: u.password || undefined,
        username: u.username || undefined,
      };
    } catch {
      return { url };
    }
  }

  async enqueue(type: JobType, payload: Record<string, unknown>): Promise<string> {
    await this.ensureConnected();
    const job = await this.queue!.add(type, { type, payload }, {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    });
    return job.id;
  }

  registerHandler(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  async getJob(jobId: string) {
    await this.ensureConnected();
    const job = await this.queue!.getJob(jobId);
    if (!job) return null;
    const state = await (this.queue as unknown as { getJobState?: (id: string) => Promise<string> }).getJobState?.(jobId);
    const status = (state || "queued") as "queued" | "active" | "completed" | "failed";
    return {
      status,
      result: job.returnvalue as JobResult | undefined,
    };
  }

  start(): void {
    this.ensureConnected()
      .then(() => {
        // L-9: reuse the connection parsed in ensureConnected (was re-parsed here).
        this.worker = new this.mod!.Worker(
          QUEUE_NAME,
          async (job: BullMQJobType) => {
            const handler = this.handlers.get(job.data.type);
            if (!handler) throw new Error(`No handler for: ${job.data.type}`);
            const result = await handler(job.data.payload);
            if (!result.ok) throw new Error(result.error || "Job failed");
            return result;
          },
          { connection: this.parsedConnection, concurrency: 3 }
        );
        this.worker.on("failed", (_job: unknown, err: unknown) => {
          log.error({ err }, "[queue] job failed");
        });
        log.info("[queue] BullMQ worker started");
      })
      .catch((err) => {
        log.error({ err: err instanceof Error ? err.message : err }, "[queue] failed to start BullMQ worker");
      });
  }

  async stop(): Promise<void> {
    await this.worker?.close().catch(() => {});
    await this.queue?.close().catch(() => {});
  }
}
