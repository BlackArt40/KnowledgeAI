// Regression (2026-10-09, CI e2e 实测): 种子配置里的 rateLimitPerMin 曾被硬编码为
// 60，静默覆盖了文档化的用户档位（RATE_LIMIT_PER_MIN，默认 200）——部署方即使
// 抬高 env，路由层仍按 60/min 拒绝（e2e 因此大面积 429）。默认值必须跟随 env。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function resetAdminStore() {
  delete (globalThis as Record<string, unknown>).__KAI_ADMIN_STORE__;
  vi.resetModules();
}

beforeEach(resetAdminStore);
afterEach(() => {
  vi.unstubAllEnvs();
  resetAdminStore();
});

describe("admin system config defaults", () => {
  it("rateLimitPerMin 跟随 RATE_LIMIT_PER_MIN（文档化的用户档位）", async () => {
    vi.stubEnv("RATE_LIMIT_PER_MIN", "1234");
    const { getConfig } = await import("./store");
    expect(getConfig().rateLimitPerMin).toBe(1234);
  });

  it("未设置 env 时回落到文档默认值 200（不是旧的 60）", async () => {
    vi.stubEnv("RATE_LIMIT_PER_MIN", "");
    const { getConfig } = await import("./store");
    expect(getConfig().rateLimitPerMin).toBe(200);
  });

  it("运行时 PATCH 仍以 store 为准（env 只提供种子默认值）", async () => {
    vi.stubEnv("RATE_LIMIT_PER_MIN", "1234");
    const { getConfig, updateConfig } = await import("./store");
    expect(updateConfig({ rateLimitPerMin: 77 }).rateLimitPerMin).toBe(77);
    expect(getConfig().rateLimitPerMin).toBe(77);
  });
});
