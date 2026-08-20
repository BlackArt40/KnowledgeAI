// P0-5 regression test: "create → restart → validate" contract for API keys.
//
// The bug: persistApiKey() stores the AES-GCM ciphertext in the `keyHash`
// column (schema has no `secret` column), but hydrateApiKeys() read a
// non-existent `r.secret` (a cast tricked the type checker; runtime value was
// `undefined`). After a DB-mode restart every key's stored secret was
// undefined → validateApiKey() could never match → all keys silently dead.
//
// This test simulates a restart: persist a key, "reload" it via
// hydrateFromDb() from a fake DB row, and assert the in-memory secret is the
// ciphertext from the keyHash column and that the plaintext secret still
// validates.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { encryptToString } from "@/lib/crypto";
import { persistApiKey } from "./persist";
import { hydrateFromDb } from "./hydrate";
import { validateApiKey } from "@/lib/apikeys/store";

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
  isDbEnabled: vi.fn(() => true),
}));

import { getDb } from "./client";

const PLAINTEXT = "kai_sk_persist_hydrate_contract_test_secret";

function makeDb() {
  const db: Record<string, { findMany: ReturnType<typeof vi.fn>; findUnique?: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> }> = {};
  // Every model used by hydrateFromDb(); empty rows except apiKey below.
  for (const m of [
    "user", "knowledgeBase", "kbDocument", "agentTask", "conversation",
    "modelConfig", "notification", "team", "systemConfig", "securityAudit",
    "subscription", "invoice", "order", "workspace", "webhookSubscription",
    "botIntegration", "kgEntity", "kgRelation",
  ]) {
    // findUnique: some hydrators (team / systemConfig) read single rows -
    // P1-10 makes a missing method throw, so the fake must cover them.
    db[m] = {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
  }
  db.apiKey = { findMany: vi.fn(), upsert: vi.fn().mockResolvedValue(undefined) };
  const findMany = db.apiKey.findMany;
  const upsert = db.apiKey.upsert;
  return { db, findMany, upsert };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Fresh stores so hydration writes into a clean slate (ensureStores()
  // recreates whatever is missing - a store left over from another test
  // would make the apiKey row a no-op or double-count).
  const g = globalThis as Record<string, unknown>;
  g.__KAI_APIKEY_STORE__ = undefined;
});

describe("API key persist → hydrate round-trip (P0-5)", () => {
  it("persists the ciphertext into keyHash (never a plaintext `secret` column)", async () => {
    const { db, upsert } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    // GCM uses a random IV - encrypt once and compare against the same blob.
    const ciphertext = encryptToString(PLAINTEXT);
    await persistApiKey({
      id: "key_roundtrip",
      userId: "usr_1",
      name: "roundtrip",
      secret: ciphertext,
      prefix: "kai_sk_persist…",
      scopes: ["chat:read"],
      status: "active",
      calls: 0,
      lastUsed: null,
      createdAt: Date.now(),
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const [options] = upsert.mock.calls[0];
    // persistApiKey: upsert({ where, update: data, create }) - data is `update`.
    expect(options.update.keyHash).toBe(ciphertext);
    expect(options.update).not.toHaveProperty("secret");
    expect(options.create.keyHash).toBe(ciphertext);
  });

  it("hydrates keys from the keyHash column and they still validate after restart", async () => {
    const { db, findMany } = makeDb();
    const ciphertext = encryptToString(PLAINTEXT);
    // Simulate the row persisted by persistApiKey() surviving a restart.
    findMany.mockResolvedValue([{
      id: "key_roundtrip",
      userId: "usr_1",
      name: "roundtrip",
      keyHash: ciphertext, // <-- the column hydrate MUST read (was r.secret)
      prefix: "kai_sk_persist…",
      scopes: ["chat:read"],
      status: "active",
      calls: 0,
      lastUsed: null,
      createdAt: new Date(),
    }]);
    vi.mocked(getDb).mockResolvedValue(db as never);

    await hydrateFromDb();

    const store = (globalThis as unknown as { __KAI_APIKEY_STORE__?: { keys: Array<{ id: string; secret: string }> } }).__KAI_APIKEY_STORE__!;
    expect(store.keys).toHaveLength(1);
    // In-memory secret is the ciphertext (consistent with createKey()).
    expect(store.keys[0].secret).toBe(ciphertext);
    // The plaintext secret still validates after the "restart".
    expect(validateApiKey(PLAINTEXT)?.id).toBe("key_roundtrip");
  });
});
