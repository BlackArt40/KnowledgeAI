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
  private connection: Record<string, unknown>;

  constructor(redisUrl: string) {
    this.connection = { host: redisUrl };
  }

  private async ensureConnected(): Promise<QueueModule> {
    if (this.mod && this.queue) return this.mod;
    try {
      const bullmq = await import("bullmq");
      this.mod = bullmq as unknown as QueueModule;
      const connection = this.parseRedisUrl(process.env.REDIS_URL!);
      this.queue = new this.mod.Queue(QUEUE_NAME, { connection });
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
        const connection = this.parseRedisUrl(process.env.REDIS_URL!);
        this.worker = new this.mod!.Worker(
          QUEUE_NAME,
          async (job: BullMQJobType) => {
            const handler = this.handlers.get(job.data.type);
            if (!handler) throw new Error(`No handler for: ${job.data.type}`);
            const result = await handler(job.data.payload);
            if (!result.ok) throw new Error(result.error || "Job failed");
            return result;
          },
          { connection, concurrency: 3 }
        );
        this.worker.on("failed", (_job: unknown, err: unknown) => {
          console.error("[queue] job failed:", err);
        });
        console.log("[queue] BullMQ worker started");
      })
      .catch((err) => {
        console.error("[queue] failed to start BullMQ worker:", err.message);
      });
  }

  async stop(): Promise<void> {
    await this.worker?.close().catch(() => {});
    await this.queue?.close().catch(() => {});
  }
}
