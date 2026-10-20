// P2 regression: new API keys must be stored one-way (sha256$) and expire;
// legacy AES-encrypted rows must keep validating during the migration window.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/persist", () => ({
  persistApiKey: vi.fn(async () => {}),
  deleteApiKeyFromDb: vi.fn(async () => {}),
}));

import { encryptToString } from "@/lib/crypto";
import { createKey, validateApiKey } from "./store";
import type { ApiKey } from "./types";

const g = globalThis as unknown as { __KAI_APIKEY_STORE__?: { keys: ApiKey[]; logs: unknown[] } };

beforeEach(() => {
  delete process.env.API_KEY_TTL_DAYS;
  g.__KAI_APIKEY_STORE__ = undefined;
});

describe("API key hashing + expiry (P2)", () => {
  it("stores only sha256$ and still validates the plaintext", () => {
    const key = createKey("test", ["kb:read"], "usr_1", null);

    const stored = g.__KAI_APIKEY_STORE__!.keys[0];
    expect(stored.secret).toMatch(/^sha256\$[0-9a-f]{64}$/);
    expect(stored.secret).not.toContain(key.secret);

    expect(validateApiKey(key.secret)?.id).toBe(key.id);
    expect(validateApiKey("kai_sk_wrong")).toBeNull();
  });

  it("rejects an expired key and defaults new keys to a future expiry", () => {
    const expired = createKey("old", [], "usr_1", Date.now() - 1000);
    expect(validateApiKey(expired.secret)).toBeNull();

    const fresh = createKey("new", [], "usr_1");
    expect(fresh.expiresAt).toBeGreaterThan(Date.now());
  });

  it("keeps validating legacy AES-encrypted rows", () => {
    const plaintext = "kai_sk_legacy_key_123456";
    g.__KAI_APIKEY_STORE__ = {
      keys: [{
        id: "key_legacy",
        userId: "usr_1",
        name: "legacy",
        prefix: "kai_sk_lega…3456",
        secret: encryptToString(plaintext),
        scopes: ["kb:read"],
        status: "active",
        createdAt: Date.now(),
        lastUsed: null,
        calls: 0,
        expiresAt: null,
      }],
      logs: [],
    };

    expect(validateApiKey(plaintext)?.id).toBe("key_legacy");
    expect(validateApiKey("kai_sk_other")).toBeNull();
  });
});
