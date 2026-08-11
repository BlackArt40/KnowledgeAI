// P6-3 unit tests: billing/store (in-memory subscription/order/usage state).
import { describe, it, expect, beforeEach } from "vitest";
import {
  getSubscription,
  cancelSubscription,
  resumeSubscription,
  listInvoices,
  listAllInvoices,
  getUsage,
  recordQa,
  getWorkspaceUsage,
  recordAgentTask,
  recordWorkspaceStorage,
  createOrder,
  getOrder,
  payOrder,
} from "./store";
import { seed as seedUsers } from "@/lib/auth/store";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_BILLING_STORE__;
  delete (globalThis as Record<string, unknown>).__KAI_WS_USAGE_STORE__;
  delete (globalThis as Record<string, unknown>).__KAI_USER_STORE__;
  seedUsers();
});

describe("subscriptions", () => {
  it("seeded users get their plan subscriptions; viewer gets default free", () => {
    expect(getSubscription("usr_owner").plan).toBe("enterprise");
    expect(getSubscription("usr_admin").plan).toBe("pro");
    const free = getSubscription("usr_viewer");
    expect(free.plan).toBe("free");
    expect(free.status).toBe("active");
  });

  it("cancel sets cancelAtPeriodEnd + canceled; resume restores", () => {
    const sub = cancelSubscription("usr_owner");
    expect(sub.status).toBe("canceled");
    expect(sub.cancelAtPeriodEnd).toBe(true);
    const resumed = resumeSubscription("usr_owner");
    expect(resumed.status).toBe("active");
    expect(resumed.cancelAtPeriodEnd).toBe(false);
  });
});

describe("invoices", () => {
  it("lists per-user invoices newest first and admin sees all", () => {
    const mine = listInvoices("usr_owner");
    expect(mine.length).toBe(5);
    expect(mine[0].date).toBeGreaterThanOrEqual(mine[mine.length - 1].date);
    expect(listAllInvoices().length).toBe(15);
    expect(listInvoices("usr_viewer")).toEqual([]);
  });
});

describe("usage", () => {
  it("recordQa bumps per-user + per-workspace meters and trend", () => {
    const before = getUsage("usr_owner").qaUsed;
    recordQa("usr_owner", "ws_test");
    expect(getUsage("usr_owner").qaUsed).toBe(before + 1);
    expect(getWorkspaceUsage("ws_test").qaUsed).toBe(1);
  });

  it("agent task + storage workspace metering", () => {
    recordAgentTask("ws_test");
    recordWorkspaceStorage("ws_test", 2048);
    const w = getWorkspaceUsage("ws_test");
    expect(w.agentTasks).toBe(1);
    expect(w.storageBytes).toBe(2048);
    recordWorkspaceStorage("ws_test", -5); // clamps to 0
    expect(getWorkspaceUsage("ws_test").storageBytes).toBe(0);
  });

  it("usage trend stays within 14 points", () => {
    const u = getUsage("usr_owner");
    expect(u.trend.length).toBeLessThanOrEqual(14);
    expect(u.trend.length).toBeGreaterThan(0);
  });
});

describe("orders", () => {
  it("createOrder makes pending orders with plan price", () => {
    const o = createOrder("pro", "alipay", "usr_viewer");
    expect(o.plan).toBe("pro");
    expect(o.amount).toBe(49);
    expect(o.status).toBe("pending");
    expect(getOrder(o.id)?.userId).toBe("usr_viewer");
    expect(getOrder("missing")).toBeUndefined();
  });

  it("payOrder upgrades the user's plan and subscription; rejects foreign orders", () => {
    const o = createOrder("pro", "wechat", "usr_viewer");
    const foreign = payOrder(o.id, "usr_editor");
    expect(foreign.success).toBe(false);
    const paid = payOrder(o.id, "usr_viewer");
    expect(paid.success).toBe(true);
    expect(paid.order.status).toBe("paid");
    expect(getSubscription("usr_viewer").plan).toBe("pro");
    const missing = payOrder("nope", "usr_viewer");
    expect(missing.success).toBe(false);
  });
});
