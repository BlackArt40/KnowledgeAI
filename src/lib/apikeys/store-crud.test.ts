// P0 (batch 1): API key CRUD, call logging and row merging. The hashing /
// expiry / shared-read paths already have dedicated files (store-hash,
// store-shared); this one closes the CRUD + counter gaps.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/persist", () => ({
  persistApiKey: vi.fn(async () => {}),
  deleteApiKeyFromDb: vi.fn(async () => {}),
}));

import { deleteApiKeyFromDb, persistApiKey } from "@/lib/db/persist";
import {
  createKey,
  deleteKey,
  listKeys,
  listLogs,
  logCall,
  mergeApiKeyRow,
  toggleKey,
} from "./store";
import type { ApiKey } from "./types";

const g = globalThis as unknown as { __KAI_APIKEY_STORE__?: { keys: ApiKey[]; logs: unknown[] } };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.API_KEY_TTL_DAYS;
  g.__KAI_APIKEY_STORE__ = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.API_KEY_TTL_DAYS;
  g.__KAI_APIKEY_STORE__ = undefined;
});

describe("createKey", () => {
  it("returns the plaintext once but stores only a hash and a masked prefix", () => {
    const key = createKey("deploy", ["kb:read"], "usr_1", null);

    expect(key.secret).toMatch(/^kai_sk_/);
    const stored = g.__KAI_APIKEY_STORE__!.keys[0];
    expect(stored.secret).not.toBe(key.secret);
    expect(stored.prefix).toBe(`${key.secret.slice(0, 12)}…${key.secret.slice(-4)}`);
    expect(stored.status).toBe("active");
    expect(stored.calls).toBe(0);
    expect(stored.lastUsed).toBeNull();
    expect(persistApiKey).toHaveBeenCalledWith(stored);
  });

  it("falls back to a placeholder name", () => {
    expect(createKey("", [], "usr_1", null).name).toBe("未命名密钥");
  });

  it("defaults the expiry to API_KEY_TTL_DAYS days", () => {
    process.env.API_KEY_TTL_DAYS = "30";
    const key = createKey("ttl", [], "usr_1");
    expect(key.expiresAt).not.toBeNull();
    const days = (key.expiresAt! - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it("never expires when the TTL is non-positive or unparseable", () => {
    process.env.API_KEY_TTL_DAYS = "0";
    expect(createKey("never", [], "usr_1").expiresAt).toBeNull();

    process.env.API_KEY_TTL_DAYS = "-5";
    expect(createKey("negative", [], "usr_1").expiresAt).toBeNull();

    process.env.API_KEY_TTL_DAYS = "not-a-number";
    expect(createKey("bad", [], "usr_1").expiresAt).toBeNull();
  });
});

describe("listKeys", () => {
  it("scopes to the owner and sorts newest first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const older = createKey("older", [], "usr_1", null);
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const newer = createKey("newer", [], "usr_1", null);
    vi.setSystemTime(new Date("2026-01-03T00:00:00Z"));
    createKey("someone else", [], "usr_2", null);

    expect(listKeys("usr_1").map((k) => k.id)).toEqual([newer.id, older.id]);
    expect(listKeys("usr_2")).toHaveLength(1);
    expect(listKeys("usr_missing")).toEqual([]);
  });
});

describe("toggleKey / deleteKey", () => {
  it("toggles the status for the owner only", () => {
    const key = createKey("toggle", [], "usr_1", null);

    expect(toggleKey(key.id, "disabled", "usr_2")).toBeNull();
    expect(toggleKey("key_missing", "disabled", "usr_1")).toBeNull();

    const toggled = toggleKey(key.id, "disabled", "usr_1");
    expect(toggled?.status).toBe("disabled");
    expect(g.__KAI_APIKEY_STORE__!.keys[0].status).toBe("disabled");
  });

  it("refuses to delete another user's key", () => {
    const key = createKey("mine", [], "usr_1", null);
    expect(deleteKey(key.id, "usr_2")).toBe(false);
    expect(listKeys("usr_1")).toHaveLength(1);
  });

  it("deletes the key, its DB row and its call logs", () => {
    const key = createKey("gone", [], "usr_1", null);
    logCall(key.id, "/api/v1/kb", "GET", 200, 12);
    expect(g.__KAI_APIKEY_STORE__!.logs).toHaveLength(1);

    expect(deleteKey(key.id, "usr_1")).toBe(true);
    expect(listKeys("usr_1")).toEqual([]);
    expect(g.__KAI_APIKEY_STORE__!.logs).toHaveLength(0);
    expect(deleteApiKeyFromDb).toHaveBeenCalledWith(key.id);
    expect(deleteKey("key_missing", "usr_1")).toBe(false);
  });
});

describe("logCall + listLogs", () => {
  it("increments counters and records the call", () => {
    const key = createKey("logged", [], "usr_1", null);
    logCall(key.id, "/api/v1/kb", "GET", 200, 12);

    const [stored] = listKeys("usr_1");
    expect(stored.calls).toBe(1);
    expect(stored.lastUsed).not.toBeNull();
    expect(persistApiKey).toHaveBeenCalled();

    const logs = listLogs("usr_1");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ keyId: key.id, endpoint: "/api/v1/kb", method: "GET", status: 200, latencyMs: 12 });
  });

  it("records a call even when the key id is unknown", () => {
    logCall("key_unknown", "/x", "GET", 401, 1);
    expect(g.__KAI_APIKEY_STORE__!.logs).toHaveLength(1);
  });

  it("scopes logs to the caller's keys and sorts newest first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    const mine = createKey("mine", [], "usr_1", null);
    const other = createKey("other", [], "usr_2", null);

    logCall(mine.id, "/first", "GET", 200, 1);
    vi.setSystemTime(new Date("2026-02-01T00:00:05Z"));
    logCall(mine.id, "/second", "GET", 200, 1);
    logCall(other.id, "/not-mine", "GET", 200, 1);

    const logs = listLogs("usr_1");
    expect(logs.map((l) => l.endpoint)).toEqual(["/second", "/first"]);
  });

  it("keeps at most 100 logs per user and 500 globally", () => {
    const key = createKey("chatty", [], "usr_1", null);
    for (let i = 0; i < 510; i++) logCall(key.id, `/e${i}`, "GET", 200, 1);

    expect(listLogs("usr_1").length).toBeLessThanOrEqual(100);
    expect(g.__KAI_APIKEY_STORE__!.logs.length).toBeLessThanOrEqual(500);
  });
});

describe("mergeApiKeyRow", () => {
  const row = {
    id: "key_merged",
    userId: "usr_1",
    name: "merged",
    keyHash: "sha256$deadbeef",
    prefix: "kai_sk_merg…dead",
    scopes: ["kb:read"],
    status: "active",
    calls: 7,
    lastUsed: new Date("2026-03-01T00:00:00Z"),
    expiresAt: new Date("2026-04-01T00:00:00Z"),
    createdAt: new Date("2026-02-01T00:00:00Z"),
  };

  it("converts Date columns to epoch millis", () => {
    mergeApiKeyRow(row);

    const [stored] = listKeys("usr_1");
    expect(stored).toMatchObject({
      id: "key_merged",
      secret: "sha256$deadbeef",
      calls: 7,
      lastUsed: row.lastUsed.getTime(),
      expiresAt: row.expiresAt.getTime(),
      createdAt: row.createdAt.getTime(),
    });
  });

  it("keeps null timestamps null", () => {
    mergeApiKeyRow({ ...row, id: "key_no_dates", lastUsed: null, expiresAt: null });

    const stored = listKeys("usr_1").find((k) => k.id === "key_no_dates");
    expect(stored?.lastUsed).toBeNull();
    expect(stored?.expiresAt).toBeNull();
  });

  it("skips rows already present in memory", () => {
    mergeApiKeyRow(row);
    mergeApiKeyRow({ ...row, name: "shadowed" });

    expect(listKeys("usr_1")).toHaveLength(1);
    expect(listKeys("usr_1")[0].name).toBe("merged");
  });
});
