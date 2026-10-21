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

// 套餐是工作区级（P4-3 升级只写 workspace.plan），管理端不能再读 users.plan：
// 否则升级过的成员在用户表里永远显示 free，月收入也按人头重复计费。
describe("admin plan source (workspace-level)", () => {
  it("用户表的 plan 取工作区套餐，而不是 users.plan", async () => {
    const { listUsers } = await import("./store");
    const { setWorkspacePlan, getWorkspace } = await import("@/lib/workspace/store");
    const ws = getWorkspace("ws_default")!;
    const original = ws.plan;
    // 种子 owner 的 users.plan 是 enterprise，工作区改成 free → 必须显示 free
    setWorkspacePlan("ws_default", "free");
    try {
      const owner = listUsers().find((u) => u.email === "owner@knowledgeai.dev");
      expect(owner?.plan).toBe("free");
    } finally {
      setWorkspacePlan("ws_default", original);
    }
  });

  it("月收入按工作区去重（同一工作区多名成员只计一次）", async () => {
    const { getOverview } = await import("./store");
    const { listAllWorkspaces } = await import("@/lib/workspace/store");
    const expected = listAllWorkspaces().reduce(
      (sum, ws) => sum + ({ free: 0, pro: 49, enterprise: 299 }[ws.plan] ?? 0),
      0
    );
    expect(getOverview().stats.monthlyRevenue).toBe(expected);
    // 种子工作区 4 名成员、pro 套餐 → 49（而非 4 × 49）
    expect(getOverview().stats.monthlyRevenue).toBe(49);
  });
});
