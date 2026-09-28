// Queue observability aggregation: the public queue facade must expose a
// backend-neutral snapshot without leaking BullMQ details to monitoring.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const globals = globalThis as unknown as { __KAI_QUEUE_INSTANCE__?: unknown };

beforeEach(() => {
  delete globals.__KAI_QUEUE_INSTANCE__;
  vi.stubEnv("REDIS_URL", "");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete globals.__KAI_QUEUE_INSTANCE__;
});

describe("getQueueStats", () => {
  it("reports the in-memory backend as an available snapshot", async () => {
    const { getQueueStats } = await import("./index");
    const snapshot = await getQueueStats();

    expect(snapshot).toMatchObject({
      mode: "memory",
      available: true,
      queues: [
        {
          name: "memory",
          concurrency: 3,
          counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 },
        },
      ],
    });
    expect(snapshot.capturedAt).toEqual(expect.any(Number));
  });

  it("returns an unavailable snapshot when the backend stats call fails", async () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6380");
    globals.__KAI_QUEUE_INSTANCE__ = {
      enqueue: async () => "job_1",
      registerHandler: () => undefined,
      getJob: async () => null,
      getStats: async () => {
        throw new Error("redis down");
      },
      start: () => undefined,
      stop: async () => undefined,
    };

    const { getQueueStats } = await import("./index");
    const snapshot = await getQueueStats();

    expect(snapshot).toMatchObject({
      mode: "redis",
      available: false,
      queues: [],
      error: "queue stats unavailable",
    });
    expect(snapshot.capturedAt).toEqual(expect.any(Number));
  });
});
