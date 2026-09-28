// Queue observability: the in-process backend must expose the same bounded
// waiting/active/delayed/terminal snapshot shape as the Redis backend.
import { describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "./memory-queue";

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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
});
