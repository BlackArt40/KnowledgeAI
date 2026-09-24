// Regression: agent-run must stay on its own BullMQ queue/worker so slow LLM
// jobs cannot occupy the fast queue and delay document processing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockJob {
  id: string;
  data: { type: string; payload: Record<string, unknown> };
  returnvalue: unknown;
  updateProgress: (progress: number) => void;
}

interface MockQueue {
  name: string;
  options: unknown;
  jobs: Map<string, MockJob>;
  states: Map<string, string>;
  add: (name: string, data: unknown, opts?: unknown) => Promise<MockJob>;
  getJob: (id: string) => Promise<MockJob | null>;
  getJobState: (id: string) => Promise<string | undefined>;
  close: () => Promise<void>;
}

interface MockWorker {
  name: string;
  processor: (job: MockJob) => Promise<unknown>;
  options: { connection: unknown; concurrency: number };
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  close: () => Promise<void>;
}

const mocks = vi.hoisted(() => {
  const queues: MockQueue[] = [];
  const workers: MockWorker[] = [];
  let nextJobId = 1;

  const queueCtor = vi.fn(function (name: string, options: unknown) {
    const queue: MockQueue = {
      name,
      options,
      jobs: new Map(),
      states: new Map(),
      add: vi.fn(async (jobName: string, data: unknown, opts?: unknown) => {
        const job: MockJob = {
          id: `job_${nextJobId++}`,
          data: data as MockJob["data"],
          returnvalue: undefined,
          updateProgress: vi.fn(),
        };
        void jobName;
        void opts;
        queue.jobs.set(job.id, job);
        return job;
      }),
      getJob: vi.fn(async (id: string) => queue.jobs.get(id) ?? null),
      getJobState: vi.fn(async (id: string) => queue.states.get(id) ?? "queued"),
      close: vi.fn(async () => undefined),
    };
    queues.push(queue);
    return queue;
  });

  const workerCtor = vi.fn(function (
    name: string,
    processor: (job: MockJob) => Promise<unknown>,
    options: { connection: unknown; concurrency: number }
  ) {
    const worker: MockWorker = {
      name,
      processor,
      options,
      on: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    workers.push(worker);
    return worker;
  });

  return { queues, workers, queueCtor, workerCtor };
});

vi.mock("bullmq", () => ({
  Queue: mocks.queueCtor,
  Worker: mocks.workerCtor,
}));

vi.mock("@/lib/obs/log", () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { BullMQQueue } from "./bullmq-queue";

const FAST_QUEUE = "knowledgeai-jobs";
const AGENT_QUEUE = "knowledgeai-agent-jobs";

beforeEach(() => {
  mocks.queues.length = 0;
  mocks.workers.length = 0;
  vi.clearAllMocks();
  vi.stubEnv("REDIS_URL", "redis://:secret@localhost:6380");
  vi.stubEnv("QUEUE_CONCURRENCY", "5");
  vi.stubEnv("QUEUE_AGENT_CONCURRENCY", "2");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BullMQQueue dual-queue topology", () => {
  it("routes agent-run to its own queue while fast jobs share the main queue", async () => {
    const queue = new BullMQQueue("redis://:secret@localhost:6380");

    await queue.enqueue("agent-run", { taskId: "task_1" });
    await queue.enqueue("doc-process", { docId: "doc_1" });

    expect(mocks.queues.map((q) => q.name)).toEqual([FAST_QUEUE, AGENT_QUEUE]);
    expect(mocks.queues[0].add).toHaveBeenCalledWith(
      "doc-process",
      { type: "doc-process", payload: { docId: "doc_1" } },
      expect.objectContaining({ attempts: 3, removeOnFail: 50 })
    );
    expect(mocks.queues[1].add).toHaveBeenCalledWith(
      "agent-run",
      { type: "agent-run", payload: { taskId: "task_1" } },
      expect.objectContaining({ attempts: 3, removeOnFail: 50 })
    );
  });

  it("finds jobs in either queue and returns their status and result", async () => {
    const queue = new BullMQQueue("redis://:secret@localhost:6380");
    const jobId = await queue.enqueue("agent-run", { taskId: "task_2" });
    const job = mocks.queues[1].jobs.get(jobId);

    expect(job).toBeDefined();
    job!.returnvalue = { ok: true, data: { taskId: "task_2" } };
    mocks.queues[1].states.set(jobId, "completed");

    await expect(queue.getJob(jobId)).resolves.toEqual({
      status: "completed",
      result: { ok: true, data: { taskId: "task_2" } },
    });
    expect(mocks.queues[0].getJob).toHaveBeenCalledWith(jobId);
    expect(mocks.queues[1].getJob).toHaveBeenCalledWith(jobId);
  });

  it("starts independent workers with the configured concurrency", async () => {
    const queue = new BullMQQueue("redis://:secret@localhost:6380");
    queue.start();

    await vi.waitFor(() => expect(mocks.workers).toHaveLength(2));

    expect(mocks.workers.map((worker) => [worker.name, worker.options.concurrency])).toEqual([
      [FAST_QUEUE, 5],
      [AGENT_QUEUE, 2],
    ]);
    for (const worker of mocks.workers) {
      expect(worker.on).toHaveBeenCalledWith("failed", expect.any(Function));
    }
  });

  it("uses conservative defaults for invalid concurrency overrides", async () => {
    vi.stubEnv("QUEUE_CONCURRENCY", "not-a-number");
    vi.stubEnv("QUEUE_AGENT_CONCURRENCY", "0");
    const queue = new BullMQQueue("redis://:secret@localhost:6380");
    queue.start();

    await vi.waitFor(() => expect(mocks.workers).toHaveLength(2));

    expect(mocks.workers.map((worker) => worker.options.concurrency)).toEqual([3, 1]);
  });

  it("closes every worker and queue during shutdown", async () => {
    const queue = new BullMQQueue("redis://:secret@localhost:6380");
    await queue.enqueue("doc-process", { docId: "doc_2" });
    queue.start();
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(2));

    await queue.stop();

    for (const worker of mocks.workers) expect(worker.close).toHaveBeenCalledOnce();
    for (const queueInstance of mocks.queues) expect(queueInstance.close).toHaveBeenCalledOnce();
  });
});
