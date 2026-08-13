// P7-1 unit tests: usage.alert webhook emitter (billing meter crossing).
import { describe, it, expect, beforeEach, vi } from "vitest";

const { events, wsPlan } = vi.hoisted(() => ({
  events: [] as unknown[][],
  wsPlan: { plan: "free" },
}));

vi.mock("@/lib/workspace/store", () => ({
  getWorkspace: (id: string) => ({ id, plan: wsPlan.plan }),
}));

vi.mock("@/lib/webhooks/store", () => ({
  emitWebhookEvent: async (...args: unknown[]) => {
    events.push(args);
    return 1;
  },
}));

import { recordQa, getWorkspaceUsage } from "./store";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_BILLING_STORE__;
  delete (globalThis as Record<string, unknown>).__KAI_WS_USAGE_STORE__;
  delete (globalThis as Record<string, unknown>).__KAI_USAGE_ALERT_STORE__;
  events.length = 0;
  wsPlan.plan = "free";
});

describe("usage.alert webhook (P7-1)", () => {
  it("emits usage.alert once when the workspace crosses the plan QA limit", async () => {
    const w = getWorkspaceUsage("ws_free");
    w.qaUsed = 99; // just below the free-plan limit (100)
    recordQa("usr_viewer", "ws_free");
    // allow the fire-and-forget emit to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([
      "ws_free",
      "usage.alert",
      expect.objectContaining({ workspaceId: "ws_free", plan: "free", usage: 100, limit: 100 }),
    ]);
  });

  it("does NOT re-alert on every request after the crossing", async () => {
    const w = getWorkspaceUsage("ws_dedup");
    w.qaUsed = 100;
    recordQa("usr_viewer", "ws_dedup");
    recordQa("usr_viewer", "ws_dedup");
    recordQa("usr_viewer", "ws_dedup");
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toHaveLength(1);
  });

  it("never alerts for unlimited plans", async () => {
    wsPlan.plan = "pro"; // qaLimit = null
    const w = getWorkspaceUsage("ws_pro");
    w.qaUsed = 5000;
    recordQa("usr_owner", "ws_pro");
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toHaveLength(0);
  });

  it("does not alert below the limit", async () => {
    const w = getWorkspaceUsage("ws_low");
    w.qaUsed = 10;
    recordQa("usr_viewer", "ws_low");
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toHaveLength(0);
  });
});
