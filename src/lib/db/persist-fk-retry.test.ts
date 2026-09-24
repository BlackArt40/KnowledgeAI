// Regression: child rows persisted fire-and-forget can race ahead of their
// parent row and trip a FK violation (P2003). persistMessage hit this as
// Message_conversationId_fkey: a brand-new conversation + its first message
// are written concurrently, and the message could be dropped silently.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  upsert: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("@/lib/db/client", () => ({
  isDbEnabled: () => mocks.enabled,
  getDb: async () => ({
    message: { upsert: mocks.upsert },
    kbDocument: { upsert: mocks.upsert },
  }),
}));

vi.mock("@/lib/obs/log", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { persistMessage, persistDoc } from "./persist";
import { log } from "@/lib/obs/log";

const fk = () =>
  Object.assign(new Error("Foreign key constraint violated"), { code: "P2003" });

const msg = { id: "msg_1", role: "user", content: "hi", createdAt: 1_700_000_000_000 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.upsert.mockReset();
  mocks.upsert.mockImplementation(async () => undefined);
});

describe("persistMessage parent-row FK race", () => {
  it("retries P2003 and succeeds once the conversation row lands", async () => {
    mocks.upsert.mockRejectedValueOnce(fk()).mockRejectedValueOnce(fk());
    await persistMessage("conv_1", msg);
    expect(mocks.upsert).toHaveBeenCalledTimes(3);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("gives up after the retry budget and logs instead of throwing", async () => {
    mocks.upsert.mockRejectedValue(fk());
    await expect(persistMessage("conv_1", msg)).resolves.toBeUndefined();
    // 1 initial attempt + 4 retries
    expect(mocks.upsert).toHaveBeenCalledTimes(5);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      "[db] persistMessage error"
    );
  });

  it("does not retry unrelated Prisma errors", async () => {
    mocks.upsert.mockRejectedValue(
      Object.assign(new Error("unique constraint"), { code: "P2002" })
    );
    await persistMessage("conv_1", msg);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalled();
  });
});

describe("persistDoc keeps the same FK behaviour", () => {
  it("retries P2003 before giving up", async () => {
    mocks.upsert.mockRejectedValueOnce(fk());
    await persistDoc({
      id: "doc_1",
      kbId: "kb_1",
      name: "a.md",
      type: "markdown",
      size: 1,
      status: "ready",
      progress: 100,
      chunks: 1,
      uploadedAt: 1_700_000_000_000,
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(log.error).not.toHaveBeenCalled();
  });
});
