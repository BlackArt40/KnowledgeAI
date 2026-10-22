// Regression: agent-run must stay on its own BullMQ queue/worker so slow LLM
// jobs cannot occupy the fast queue and delay document processing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockJob {
  id: string;
  data: { type: string; payload: Record<string, unknown> };
  returnvalue: unknown;
  updateProgress: (progress: number) => void;
  getState: () => Promise<string>;
}

interface MockQueue {
  name: string;
  options: unknown;
  jobs: Map<string, MockJob>;
  states: Map<string, string>;
  add: (name: string, data: unknown, opts?: unknown) => Promise<MockJob>;
  addBulk: (jobs: Array<{ name: string; data: unknown; opts?: unknown }>) => Promise<MockJob[]>;
  getJobCounts: (states: string[]) => Promise<Record<string, number>>;
  getJob: (id: string) => Promise<MockJob | null>;
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
        const jobId = `job_${nextJobId++}`;
        const job: MockJob = {
          id: jobId,
          data: data as MockJob["data"],
          returnvalue: undefined,
          updateProgress: vi.fn(),
          // F16: state lives on the job (BullMQ has no queue.getJobState).
          getState: vi.fn(async () => queue.states.get(jobId) ?? "waiting"),
        };
        void jobName;
        void opts;
        queue.jobs.set(job.id, job);
        return job;
      }),
      addBulk: vi.fn(async (jobs: Array<{ name: string; data: unknown; opts?: unknown }>) =>
        Promise.all(jobs.map((j) => queue.add(j.name, j.data, j.opts)))
      ),
      getJob: vi.fn(async (id: string) => queue.jobs.get(id) ?? null),
      getJobCounts: vi.fn(async () => ({ waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 })),
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
import { QueueBackpressureError } from "./interface";

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
      expect.objectContaining({
        attempts: 3,
        removeOnFail: { age: 300, count: 100 },
        jobId: "doc-process-doc_1",
      })
    );
    expect(mocks.queues[1].add).toHaveBeenCalledWith(
      "agent-run",
      { type: "agent-run", payload: { taskId: "task_1" } },
      expect.objectContaining({
        attempts: 3,
        removeOnFail: { age: 300, count: 100 },
        jobId: "agent-run-task_1",
      })
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

  it("returns counts and concurrency for both queues", async () => {
    const queue = new BullMQQueue("redis://:secret@localhost:6380");
    await queue.enqueue("doc-process", { docId: "doc_3" });

    vi.mocked(mocks.queues[0].getJobCounts).mockResolvedValue({
      waiting: 4,
      active: 2,
      delayed: 1,
      completed: 10,
      failed: 3,
    });
    vi.mocked(mocks.queues[1].getJobCounts).mockResolvedValue({
      waiting: 7,
      active: 1,
      delayed: 0,
      completed: 2,
      failed: 1,
    });

    await expect(queue.getStats()).resolves.toEqual([
      {
        name: FAST_QUEUE,
        concurrency: 5,
        counts: { waiting: 4, active: 2, delayed: 1, completed: 10, failed: 3 },
      },
      {
        name: AGENT_QUEUE,
        concurrency: 2,
        counts: { waiting: 7, active: 1, delayed: 0, completed: 2, failed: 1 },
      },
    ]);
    for (const queueInstance of mocks.queues) {
      expect(queueInstance.getJobCounts).toHaveBeenCalledWith(
        "waiting",
        "active",
        "delayed",
        "completed",
        "failed"
      );
    }
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

  it("rejects enqueue once the backlog reaches QUEUE_MAX_DEPTH (X5/X6 backpressure)", async () => {
    vi.stubEnv("QUEUE_MAX_DEPTH", "5");
    const queue = new BullMQQueue("redis://:secret@localhost:6380");
    await queue.enqueue("doc-process", { docId: "seed" });

    vi.mocked(mocks.queues[0].getJobCounts).mockResolvedValue({
      waiting: 4,
      delayed: 1,
      active: 0,
      completed: 0,
      failed: 0,
    });
    await expect(queue.enqueue("doc-process", { docId: "blocked" })).rejects.toThrow(
      QueueBackpressureError
    );

    vi.mocked(mocks.queues[0].getJobCounts).mockResolvedValue({
      waiting: 3,
      delayed: 0,
      active: 0,
      completed: 0,
      failed: 0,
    });
    await expect(queue.enqueue("doc-process", { docId: "ok" })).resolves.toBeTruthy();
  });
});

describe("BullMQQueue.enqueueBulk", () => {
  beforeEach(() => {
    mocks.queues.length = 0;
    mocks.workers.length = 0;
  });

  it("一次 addBulk 写入全部载荷，返回等量 job id", async () => {
    const queue = new BullMQQueue("redis://mock");
    const outcome = await queue.enqueueBulk("doc-process", [
      { docId: "d1" },
      { docId: "d2" },
      { docId: "d3" },
    ]);

    expect(outcome.failures).toEqual([]);
    expect(outcome.ids).toHaveLength(3);
    // 幂等 jobId：按 docId 去重
    expect(mocks.queues[0].addBulk).toHaveBeenCalledTimes(1);
    const jobs = vi.mocked(mocks.queues[0].addBulk).mock.calls[0][0];
    expect(jobs.map((j) => j.opts && (j.opts as { jobId?: string }).jobId)).toEqual([
      "doc-process-d1",
      "doc-process-d2",
      "doc-process-d3",
    ]);
  });

  it("积压超出容量的部分逐项返回背压失败，不写队列", async () => {
    const queue = new BullMQQueue("redis://mock");
    // 队列是懒连接的：先任意调用一次，让 mock 队列实例存在再改 counts
    await queue.enqueueBulk("doc-process", [{ docId: "warm" }]);
    vi.mocked(mocks.queues[0].addBulk).mockClear();
    vi.mocked(mocks.queues[0].getJobCounts).mockResolvedValue({
      waiting: 499,
      delayed: 0,
      active: 0,
      completed: 0,
      failed: 0,
    });

    const outcome = await queue.enqueueBulk("doc-process", [
      { docId: "in" },
      { docId: "out1" },
      { docId: "out2" },
    ]);

    expect(outcome.ids).toHaveLength(1); // 剩余容量 1（默认上限 500）
    expect(outcome.failures).toHaveLength(2);
    expect(outcome.failures.map((f) => f.index)).toEqual([1, 2]);
    expect(outcome.failures[0].error).toContain("积压");
    // 只提交剩余容量内的部分
    const jobs = vi.mocked(mocks.queues[0].addBulk).mock.calls[0][0];
    expect(jobs).toHaveLength(1);
  });
});
