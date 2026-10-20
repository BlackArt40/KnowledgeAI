// Queue observability: the in-process backend must expose the same bounded
// waiting/active/delayed/terminal snapshot shape as the Redis backend.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "./memory-queue";
import { QueueBackpressureError } from "./interface";

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MemoryQueue idempotency", () => {
  it("reuses a live job for the same task/document id", async () => {
    const queue = new MemoryQueue();
    let release!: (r: { ok: boolean }) => void;
    queue.registerHandler("doc-process", () =>
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const first = await queue.enqueue("doc-process", { docId: "doc_1" });
    await tick();
    const duplicate = await queue.enqueue("doc-process", { docId: "doc_1" });
    const other = await queue.enqueue("doc-process", { docId: "doc_2" });

    expect(duplicate).toBe(first);
    expect(other).not.toBe(first);

    release({ ok: true });
    await tick();
  });
});

describe("MemoryQueue terminal-job trimming", () => {
  it("evicts only the oldest excess terminal jobs", () => {
    const queue = new MemoryQueue();
    const jobs = (queue as unknown as { jobs: Map<string, unknown> }).jobs;
    for (let i = 0; i < 120; i++) {
      jobs.set(`j${i}`, {
        id: `j${i}`,
        type: "doc-process",
        payload: {},
        status: "completed",
        createdAt: i,
        attempts: 1,
        maxAttempts: 3,
      });
    }

    (queue as unknown as { trimJobs: () => void }).trimJobs();

    expect(jobs.size).toBe(100);
    // P1: the old slice(excess) deleted almost everything; only j0..j19 go.
    expect(jobs.has("j0")).toBe(false);
    expect(jobs.has("j19")).toBe(false);
    expect(jobs.has("j20")).toBe(true);
    expect(jobs.has("j119")).toBe(true);
  });
});

describe("MemoryQueue stats", () => {
  it("reports active, waiting and concurrency while saturated", async () => {
    const queue = new MemoryQueue();
    const releases: Array<() => void> = [];
    queue.registerHandler("doc-process", (payload) => {
      if (payload.docId === "4") return Promise.resolve({ ok: true });
      return new Promise((resolve) => {
        releases.push(() => resolve({ ok: true }));
      });
    });

    await queue.enqueue("doc-process", { docId: "1" });
    await queue.enqueue("doc-process", { docId: "2" });
    await queue.enqueue("doc-process", { docId: "3" });
    await queue.enqueue("doc-process", { docId: "4" });

    await expect(queue.getStats()).resolves.toEqual([
      {
        name: "memory",
        concurrency: 3,
        counts: { waiting: 1, active: 3, delayed: 0, completed: 0, failed: 0 },
      },
    ]);

    for (const release of releases) release();
    await tick();
    await queue.stop();
  });

  it("reports completed and delayed retry jobs", async () => {
    const queue = new MemoryQueue();
    queue.registerHandler("doc-process", async () => ({ ok: true }));
    await queue.enqueue("doc-process", { docId: "ok" });
    await vi.waitFor(async () => {
      const stats = await queue.getStats();
      expect(stats[0].counts.completed).toBe(1);
    });

    queue.registerHandler("index-cleanup", async () => ({ ok: false, error: "bad" }));
    await queue.enqueue("index-cleanup", {});
    await vi.waitFor(async () => {
      const stats = await queue.getStats();
      expect(stats[0].counts.delayed).toBe(1);
      expect(stats[0].counts.failed).toBe(0);
    });

    await queue.stop();
  });

  it("counts missing handlers as failed immediately", async () => {
    const queue = new MemoryQueue();
    await queue.enqueue("webhook-deliver", { subscriptionId: "s1" });

    await expect(queue.getStats()).resolves.toEqual([
      {
        name: "memory",
        concurrency: 3,
        counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 1 },
      },
    ]);
  });

  it("rejects new jobs once the backlog hits QUEUE_MAX_DEPTH (X5/X6 backpressure)", async () => {
    vi.stubEnv("QUEUE_MAX_DEPTH", "2");
    const queue = new MemoryQueue();
    const releases: Array<() => void> = [];
    queue.registerHandler("doc-process", () =>
      new Promise((resolve) => {
        releases.push(() => resolve({ ok: true }));
      })
    );

    // 3 slots occupied (concurrency 3), then fill the 2-deep backlog.
    await queue.enqueue("doc-process", { docId: "a" });
    await queue.enqueue("doc-process", { docId: "b" });
    await queue.enqueue("doc-process", { docId: "c" });
    await queue.enqueue("doc-process", { docId: "d" });
    await queue.enqueue("doc-process", { docId: "e" });

    await expect(queue.enqueue("doc-process", { docId: "f" })).rejects.toThrow(
      QueueBackpressureError
    );
    await expect(queue.enqueue("doc-process", { docId: "g" })).rejects.toMatchObject({
      code: "queue_full",
    });

    for (const release of releases) release();
    await queue.stop();
  });
});
