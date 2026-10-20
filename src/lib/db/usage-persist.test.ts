// P1/P2 regression: workspace QA/Agent counters must be written through to
// UsageDaily with atomic BigInt increments (a plain number throws in Prisma).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
  isDbEnabled: vi.fn(() => true),
}));

import { getDb } from "./client";
import { bumpUserUsage, bumpWorkspaceUsage } from "./persist";

const upsert = vi.fn(async (_options: unknown) => ({}));
const userUpsert = vi.fn(async (_options: unknown) => ({}));

beforeEach(() => {
  upsert.mockClear();
  userUpsert.mockClear();
  vi.mocked(getDb).mockResolvedValue({
    usageDaily: { upsert },
    userUsageDaily: { upsert: userUpsert },
  } as never);
});

describe("bumpWorkspaceUsage", () => {
  it("increments the QA counter with a BigInt", async () => {
    await bumpWorkspaceUsage("ws_1", "qa");

    expect(upsert).toHaveBeenCalledTimes(1);
    const options = upsert.mock.calls[0][0] as unknown as {
      update: { qaCount?: { increment: bigint } };
      create: { qaCount: bigint; agentCount: bigint };
    };
    expect(options.update.qaCount?.increment).toBe(BigInt(1));
    expect(options.create.qaCount).toBe(BigInt(1));
    expect(options.create.agentCount).toBe(BigInt(0));
  });

  it("increments the Agent counter with a BigInt", async () => {
    await bumpWorkspaceUsage("ws_1", "agent");

    const options = upsert.mock.calls[0][0] as unknown as {
      update: { agentCount?: { increment: bigint } };
      create: { qaCount: bigint; agentCount: bigint };
    };
    expect(options.update.agentCount?.increment).toBe(BigInt(1));
    expect(options.create.agentCount).toBe(BigInt(1));
    expect(options.create.qaCount).toBe(BigInt(0));
  });

  it("bumps user QA + API counters together", async () => {
    await bumpUserUsage("usr_1", "qa");

    const options = userUpsert.mock.calls[0][0] as unknown as {
      update: { qaCount?: { increment: bigint }; apiCount?: { increment: bigint } };
      create: { qaCount: bigint; apiCount: bigint; agentCount: bigint };
    };
    expect(options.update.qaCount?.increment).toBe(BigInt(1));
    expect(options.update.apiCount?.increment).toBe(BigInt(1));
    expect(options.create.qaCount).toBe(BigInt(1));
    expect(options.create.apiCount).toBe(BigInt(1));
    expect(options.create.agentCount).toBe(BigInt(0));
  });

  it("bumps the user Agent counter separately", async () => {
    await bumpUserUsage("usr_1", "agent");

    const options = userUpsert.mock.calls[0][0] as unknown as {
      update: { agentCount?: { increment: bigint } };
      create: { qaCount: bigint; apiCount: bigint; agentCount: bigint };
    };
    expect(options.update.agentCount?.increment).toBe(BigInt(1));
    expect(options.create.agentCount).toBe(BigInt(1));
    expect(options.create.qaCount).toBe(BigInt(0));
    expect(options.create.apiCount).toBe(BigInt(0));
  });
});
