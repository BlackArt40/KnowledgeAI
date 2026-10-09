// F5: shared (cross-instance) jti revocation store - Redis mirror + the
// degradation contract that /api/health/ready surfaces.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sharedRevokeJti,
  sharedIsJtiRevoked,
  jtiStoreDegradation,
  __setJtiRedisForTest,
  __resetJtiStateForTest,
  type JtiRedisClient,
} from "./jti-shared";

function fakeClient(overrides: Partial<JtiRedisClient> = {}): JtiRedisClient {
  return {
    set: vi.fn(async () => "OK"),
    get: vi.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => {
  __resetJtiStateForTest();
  // Never let a developer-machine REDIS_URL leak into these unit tests.
  vi.stubEnv("REDIS_URL", "");
});

afterEach(() => {
  __resetJtiStateForTest();
  vi.unstubAllEnvs();
});

describe("shared jti revocation store (F5)", () => {
  it("writes revocations with the 8-day TTL under the namespaced key", async () => {
    const set = vi.fn(async () => "OK");
    __setJtiRedisForTest(fakeClient({ set }));

    sharedRevokeJti("ses_1");

    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set).toHaveBeenCalledWith("jti-blacklist:ses_1", "1", "EX", 8 * 86400);
    expect(jtiStoreDegradation().degraded).toBe(false);
  });

  it("reads revocations back from the shared store", async () => {
    __setJtiRedisForTest(fakeClient({ get: vi.fn(async () => "1") }));
    await expect(sharedIsJtiRevoked("ses_revoked")).resolves.toBe(true);

    __setJtiRedisForTest(fakeClient({ get: vi.fn(async () => null) }));
    await expect(sharedIsJtiRevoked("ses_live")).resolves.toBe(false);
  });

  it("degrades to the local map when the read fails and records it", async () => {
    __setJtiRedisForTest(
      fakeClient({ get: vi.fn(async () => { throw new Error("redis down"); }) })
    );

    await expect(sharedIsJtiRevoked("ses_x")).resolves.toBe(false);

    const d = jtiStoreDegradation();
    expect(d.degraded).toBe(true);
    expect(d.fallbacks).toBe(1);
    expect(d.lastError).toContain("redis down");
  });

  it("records a degradation when the write fails", async () => {
    __setJtiRedisForTest(
      fakeClient({ set: vi.fn(async () => { throw new Error("conn refused"); }) })
    );

    sharedRevokeJti("ses_y");

    await vi.waitFor(() => expect(jtiStoreDegradation().fallbacks).toBe(1));
    expect(jtiStoreDegradation().degraded).toBe(true);
  });

  it("is a no-op without a configured shared store (single-instance mode)", async () => {
    __setJtiRedisForTest(null);

    sharedRevokeJti("ses_z"); // must not throw
    await expect(sharedIsJtiRevoked("ses_z")).resolves.toBe(false);
    expect(jtiStoreDegradation().degraded).toBe(false);
  });
});
