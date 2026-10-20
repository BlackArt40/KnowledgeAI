import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDbRetryStatsForTest,
  dbRetrySnapshot,
  isRetryableDbError,
  withDbRetry,
} from "./retry";

beforeEach(() => {
  __resetDbRetryStatsForTest();
  vi.useRealTimers();
});

describe("withDbRetry", () => {
  it("retries transient Prisma errors and records metrics", async () => {
    let calls = 0;
    const result = await withDbRetry(async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error("connection"), { code: "P1001" });
      return "ok";
    });

    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(dbRetrySnapshot()).toMatchObject({ retries: 2, failures: 0 });
  });

  it("does not retry non-transient errors", async () => {
    let calls = 0;
    await expect(withDbRetry(async () => {
      calls++;
      throw Object.assign(new Error("duplicate"), { code: "P2002" });
    })).rejects.toThrow("duplicate");

    expect(calls).toBe(1);
    expect(dbRetrySnapshot()).toMatchObject({ retries: 0, failures: 1 });
  });

  it("classifies only connection/pool/timeout/serialization codes", () => {
    expect(isRetryableDbError({ code: "P1001" })).toBe(true);
    expect(isRetryableDbError({ code: "P2034" })).toBe(true);
    expect(isRetryableDbError({ code: "P2002" })).toBe(false);
    expect(isRetryableDbError(new Error("x"))).toBe(false);
  });
});
