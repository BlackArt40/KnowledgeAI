// Tessa test-debt #2 (P32): API-key scope matrix.
// #20 was a scope-bypass regression, and this module had no direct coverage -
// `requireApiKeyScope` is the only thing standing between a read-only key and
// the write surface of /api/v1/*.
import { describe, it, expect, beforeEach, vi } from "vitest";

const validateApiKey = vi.fn();
vi.mock("@/lib/apikeys/store", () => ({
  validateApiKey: (secret: string) => validateApiKey(secret),
  // F5: scopes.ts validates via the shared variant (memory fast path +
  // throttled DB fallback) - same underlying mock so the matrix is unchanged.
  validateApiKeyShared: async (secret: string) => validateApiKey(secret),
}));

import { requireApiKeyScope } from "./scopes";
import type { ApiKey } from "@/lib/apikeys/types";

const g = globalThis as unknown as { __KAI_APIKEY_STORE__?: unknown };

function apiKey(scopes: string[]): ApiKey {
  return {
    id: "key_1",
    userId: "usr_1",
    name: "测试密钥",
    prefix: "kai_sk_abc…",
    secret: "enc",
    scopes,
    status: "active",
    createdAt: Date.now(),
    lastUsed: null,
    calls: 0,
  };
}

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/v1/knowledge-bases", { headers });
}

beforeEach(() => {
  validateApiKey.mockReset();
  delete g.__KAI_APIKEY_STORE__;
});

describe("requireApiKeyScope", () => {
  it("passes JWT/session callers through untouched (no key, no error)", async () => {
    const r = await requireApiKeyScope(req({ authorization: "Bearer eyJhbGciOi...JWT" }), "kb:write");
    expect(r.key).toBeNull();
    expect(r.error).toBeNull();
    expect(validateApiKey).not.toHaveBeenCalled();
  });

  it("passes cookie-only callers through (no Authorization header)", async () => {
    const r = await requireApiKeyScope(req({ cookie: "kai-token=eyJ..." }), "kb:write");
    expect(r.key).toBeNull();
    expect(r.error).toBeNull();
  });

  it("401s an unknown / revoked API key", async () => {
    validateApiKey.mockReturnValue(null);
    const r = await requireApiKeyScope(req({ authorization: "Bearer kai_sk_deadbeef" }), "kb:read");
    expect(r.key).toBeNull();
    expect(r.error?.status).toBe(401);
    await expect(r.error!.json()).resolves.toEqual({ error: "无效的 API Key" });
  });

  it("403s a key that lacks the required scope (#20 regression)", async () => {
    validateApiKey.mockReturnValue(apiKey(["kb:read"]));
    const r = await requireApiKeyScope(req({ authorization: "Bearer kai_sk_readonly" }), "kb:write");
    expect(r.key).toBeNull();
    expect(r.error?.status).toBe(403);
    expect(r.error?.headers.get("X-KAI-Required-Scope")).toBe("kb:write");
  });

  it("accepts a key holding the required scope", async () => {
    const key = apiKey(["kb:read", "kb:write"]);
    validateApiKey.mockReturnValue(key);
    const r = await requireApiKeyScope(req({ authorization: "Bearer kai_sk_full" }), "kb:write");
    expect(r.error).toBeNull();
    expect(r.key?.id).toBe("key_1");
  });

  it("treats a missing scope list as no access", async () => {
    validateApiKey.mockReturnValue(apiKey([]));
    const r = await requireApiKeyScope(req({ authorization: "Bearer kai_sk_noscope" }), "kb:read");
    expect(r.error?.status).toBe(403);
  });

  it("is not bypassable by a prefix-less bearer token", async () => {
    // A token that merely LOOKS like a key but lacks the kai_sk_ prefix is a
    // JWT path - it must not be validated as a key, and vice versa.
    validateApiKey.mockReturnValue(apiKey(["kb:read"]));
    const r = await requireApiKeyScope(req({ authorization: "Bearer kai_sk" }), "kb:read");
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(r.error).toBeNull();
  });
});
