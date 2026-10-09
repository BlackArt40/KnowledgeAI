// F5: validateApiKeyShared - memory fast path + throttled DB sweep so keys
// created on other instances validate here without a restart.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encryptToString } from "@/lib/crypto";

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
  isDbEnabled: vi.fn(() => true),
}));

import { getDb, isDbEnabled } from "@/lib/db/client";
import { validateApiKey, validateApiKeyShared, __resetApiKeySweepForTest } from "./store";

const PLAINTEXT = "kai_sk_shared_read_path_test_secret";

function activeRow(keyHash: string) {
  return {
    id: "key_shared",
    userId: "usr_1",
    name: "shared",
    keyHash,
    prefix: "kai_sk_shared…",
    scopes: ["kb:read"],
    status: "active",
    calls: 0,
    lastUsed: null,
    createdAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isDbEnabled).mockReturnValue(true);
  __resetApiKeySweepForTest();
  (globalThis as Record<string, unknown>).__KAI_APIKEY_STORE__ = undefined;
});

afterEach(() => {
  __resetApiKeySweepForTest();
  (globalThis as Record<string, unknown>).__KAI_APIKEY_STORE__ = undefined;
});

describe("validateApiKeyShared (F5)", () => {
  it("picks up a key created on another instance via a DB sweep", async () => {
    const findMany = vi.fn(async () => [activeRow(encryptToString(PLAINTEXT))]);
    vi.mocked(getDb).mockResolvedValue({ apiKey: { findMany } } as never);

    // Memory knows nothing yet (the key was created on another instance).
    expect(validateApiKey(PLAINTEXT)).toBeNull();

    const key = await validateApiKeyShared(PLAINTEXT);
    expect(key?.id).toBe("key_shared");
    // The sweep merged the row into memory - later checks hit the fast path.
    expect(validateApiKey(PLAINTEXT)?.id).toBe("key_shared");
  });

  it("throttles DB sweeps so garbage tokens cannot hammer the DB", async () => {
    const findMany = vi.fn(async () => []);
    vi.mocked(getDb).mockResolvedValue({ apiKey: { findMany } } as never);

    expect(await validateApiKeyShared("kai_sk_garbage_1")).toBeNull();
    expect(await validateApiKeyShared("kai_sk_garbage_2")).toBeNull();

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("never queries the DB when DB is disabled (demo mode)", async () => {
    vi.mocked(isDbEnabled).mockReturnValue(false);

    expect(await validateApiKeyShared("kai_sk_anything")).toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("fails closed when the sweep itself throws", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("db down"));

    await expect(validateApiKeyShared("kai_sk_anything")).resolves.toBeNull();
  });
});
