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

// BullMQ types (dynamic import - lazily loaded when REDIS_URL is set)
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

/** Fast jobs: doc-process / index-cleanup / webhook-deliver / email-send. */
const FAST_QUEUE_NAME = "knowledgeai-jobs";
/** Long-running LLM jobs get their own queue and worker so a slow agent run
 *  cannot occupy every slot and starve document processing (observed: three
 *  64-105s agent runs left an upload queued for ~5 minutes). */
const AGENT_QUEUE_NAME = "knowledgeai-agent-jobs";
const AGENT_JOB_TYPES: ReadonlySet<JobType> = new Set<JobType>(["agent-run"]);

function queueNameFor(type: JobType): string {
  return AGENT_JOB_TYPES.has(type) ? AGENT_QUEUE_NAME : FAST_QUEUE_NAME;
}

/** Positive integer env override, else the fallback. */
function concurrencyFrom(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class BullMQQueue implements JobQueue {
  /** One Queue per name - fast jobs and agent jobs are enqueued separately. */
  private queues = new Map<string, BullMQQueueType>();
  private workers: BullMQWorkerType[] = [];
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
    if (this.mod && this.queues.size > 0) return this.mod;
    try {
      const bullmq = await import("bullmq");
      this.mod = bullmq as unknown as QueueModule;
      this.parsedConnection = this.parseRedisUrl(process.env.REDIS_URL!);
      for (const name of [FAST_QUEUE_NAME, AGENT_QUEUE_NAME]) {
        this.queues.set(name, new this.mod.Queue(name, { connection: this.parsedConnection }));
      }
      return this.mod;
    } catch {
      throw new Error("bullmq/ioredis load failed - verify dependencies are installed (pnpm install)");
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
    const queue = this.queues.get(queueNameFor(type));
    if (!queue) throw new Error("queue not connected");
    const job = await queue.add(type, { type, payload }, {
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
    for (const queue of this.queues.values()) {
      const job = await queue.getJob(jobId);
      if (!job) continue;
      const state = await (queue as unknown as { getJobState?: (id: string) => Promise<string> }).getJobState?.(jobId);
      const status = (state || "queued") as "queued" | "active" | "completed" | "failed";
      return {
        status,
        result: job.returnvalue as JobResult | undefined,
      };
    }
    return null;
  }

  start(): void {
    this.ensureConnected()
      .then(() => {
        const process = async (job: BullMQJobType) => {
          const handler = this.handlers.get(job.data.type);
          if (!handler) throw new Error(`No handler for: ${job.data.type}`);
          const result = await handler(job.data.payload);
          if (!result.ok) throw new Error(result.error || "Job failed");
          return result;
        };
        const fastConcurrency = concurrencyFrom("QUEUE_CONCURRENCY", 3);
        const agentConcurrency = concurrencyFrom("QUEUE_AGENT_CONCURRENCY", 1);
        for (const [name, concurrency] of [
          [FAST_QUEUE_NAME, fastConcurrency],
          [AGENT_QUEUE_NAME, agentConcurrency],
        ] as const) {
          const worker = new this.mod!.Worker(name, process, {
            connection: this.parsedConnection,
            concurrency,
          });
          worker.on("failed", (_job: unknown, err: unknown) => {
            log.error({ err }, "[queue] job failed");
          });
          this.workers.push(worker);
        }
        log.info(
          { queue: FAST_QUEUE_NAME, concurrency: fastConcurrency, agentQueue: AGENT_QUEUE_NAME, agentConcurrency },
          "[queue] BullMQ workers started"
        );
      })
      .catch((err) => {
        log.error({ err: err instanceof Error ? err.message : err }, "[queue] failed to start BullMQ worker");
      });
  }

  async stop(): Promise<void> {
    for (const worker of this.workers) await worker.close().catch(() => {});
    for (const queue of this.queues.values()) await queue.close().catch(() => {});
    this.workers = [];
    this.queues.clear();
  }
}
