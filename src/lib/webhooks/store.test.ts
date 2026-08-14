// P7-1 unit tests: webhook subscription store (CRUD + signing + delivery).
import { describe, it, expect, beforeEach, vi } from "vitest";

const { enqueueCalls } = vi.hoisted(() => ({ enqueueCalls: [] as unknown[][] }));

vi.mock("@/lib/queue", () => ({
  enqueue: async (...args: unknown[]) => {
    enqueueCalls.push(args);
    return "job_1";
  },
}));

import {
  createWebhookSubscription,
  listWebhookSubscriptions,
  getWebhookSubscription,
  updateWebhookSubscription,
  deleteWebhookSubscription,
  resetWebhookStore,
  isValidWebhookUrl,
  signWebhookPayload,
  recordDelivery,
  listDeliveryRecords,
  markDeliveryOutcome,
  emitWebhookEvent,
} from "./store";

beforeEach(() => {
  resetWebhookStore();
  enqueueCalls.length = 0;
});

describe("webhook subscriptions", () => {
  it("create + list scoped by workspace, newest first", async () => {
    const a = createWebhookSubscription({
      userId: "u1", workspaceId: "ws_default", name: "A", url: "https://a.example.com/h",
      secret: "s", events: ["kb.ready"],
    });
    // stagger createdAt so the newest-first sort is deterministic
    await new Promise((r) => setTimeout(r, 5));
    const b = createWebhookSubscription({
      userId: "u1", workspaceId: "ws_default", name: "B", url: "https://b.example.com/h",
      events: ["agent.completed", "usage.alert"],
    });
    createWebhookSubscription({
      userId: "u1", workspaceId: "ws_other", name: "C", url: "https://c.example.com/h",
      events: ["kb.ready"],
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const mine = listWebhookSubscriptions("ws_default");
    expect(mine.map((s) => s.name)).toEqual(["B", "A"]);
    expect(mine.every((s) => s.workspaceId === "ws_default")).toBe(true);
  });

  it("rejects empty/unknown events and validates URLs", () => {
    const bad = createWebhookSubscription({
      userId: "u1", workspaceId: "w", name: "x", url: "https://x.example.com", events: [],
    });
    expect(bad).toBeNull();
    const unknown = createWebhookSubscription({
      userId: "u1", workspaceId: "w", name: "x", url: "https://x.example.com", events: ["nope" as never],
    });
    expect(unknown).toBeNull();
    expect(isValidWebhookUrl("https://ok.example.com")).toBe(true);
    expect(isValidWebhookUrl("http://ok.example.com")).toBe(true);
    expect(isValidWebhookUrl("file:///etc/passwd")).toBe(false);
    expect(isValidWebhookUrl("not-a-url")).toBe(false);
  });

  it("update (toggle/rename/events) and delete", () => {
    const sub = createWebhookSubscription({
      userId: "u1", workspaceId: "w", name: "A", url: "https://a.example.com", events: ["kb.ready"],
    })!;
    const updated = updateWebhookSubscription(sub.id, { active: false, name: "A2" });
    expect(updated?.active).toBe(false);
    expect(updated?.name).toBe("A2");
    expect(getWebhookSubscription(sub.id)?.name).toBe("A2");
    // invalid events patch rejected
    expect(updateWebhookSubscription(sub.id, { events: [] })).toBeNull();
    expect(deleteWebhookSubscription(sub.id)).toBe(true);
    expect(getWebhookSubscription(sub.id)).toBeUndefined();
    expect(deleteWebhookSubscription(sub.id)).toBe(false);
  });

  it("HMAC signing is deterministic and secret-dependent", async () => {
    const body = JSON.stringify({ event: "ping", ts: 1, data: {} });
    const s1 = await signWebhookPayload("secret-1", body);
    const s2 = await signWebhookPayload("secret-1", body);
    const s3 = await signWebhookPayload("secret-2", body);
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(s1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("delivery records ring + outcome tracking + tenant isolation", () => {
    const sub = createWebhookSubscription({
      userId: "u1", workspaceId: "w", name: "A", url: "https://a.example.com", events: ["kb.ready"],
    })!;
    recordDelivery({ subscriptionId: sub.id, workspaceId: "w", event: "kb.ready", status: 200, latencyMs: 12 });
    recordDelivery({ subscriptionId: sub.id, workspaceId: "w", event: "kb.ready", status: "error", latencyMs: 900, detail: "ECONNREFUSED" });
    // A delivery from ANOTHER workspace must never be visible to ws "w".
    const other = createWebhookSubscription({
      userId: "u1", workspaceId: "ws_other", name: "O", url: "https://o.example.com", events: ["kb.ready"],
    })!;
    recordDelivery({ subscriptionId: other.id, workspaceId: "ws_other", event: "kb.ready", status: 200, latencyMs: 5 });

    expect(listDeliveryRecords("w", sub.id).length).toBe(2);
    expect(listDeliveryRecords("w", sub.id)[0].status).toBe("error");
    expect(listDeliveryRecords("w").length).toBe(2); // ws_other record filtered out
    expect(listDeliveryRecords("ws_other").length).toBe(1);
    expect(listDeliveryRecords("w").every((d) => d.workspaceId === "w")).toBe(true);

    markDeliveryOutcome(sub.id, false, "HTTP 500");
    expect(getWebhookSubscription(sub.id)?.failures).toBe(1);
    expect(getWebhookSubscription(sub.id)?.lastError).toBe("HTTP 500");
    markDeliveryOutcome(sub.id, true);
    expect(getWebhookSubscription(sub.id)?.failures).toBe(0);
    expect(getWebhookSubscription(sub.id)?.lastError).toBeNull();
    expect(getWebhookSubscription(sub.id)?.lastDeliveryAt).not.toBeNull();
  });

  it("emitWebhookEvent enqueues one delivery job per matching ACTIVE sub", async () => {
    const sub = createWebhookSubscription({
      userId: "u1", workspaceId: "w", name: "A", url: "https://a.example.com", events: ["kb.ready"],
    })!;
    createWebhookSubscription({
      userId: "u1", workspaceId: "w", name: "inactive", url: "https://b.example.com",
      events: ["kb.ready"],
    });
    updateWebhookSubscription(sub.id, { active: false });
    const other = createWebhookSubscription({
      userId: "u1", workspaceId: "w", name: "agent", url: "https://c.example.com",
      events: ["agent.completed"],
    })!;

    const n = await emitWebhookEvent("w", "agent.completed", { taskId: "task_1" });
    expect(n).toBe(1);
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0][0]).toBe("webhook-deliver");
    expect(enqueueCalls[0][1]).toEqual(expect.objectContaining({
      subscriptionId: other.id,
      payload: expect.objectContaining({ event: "agent.completed" }),
    }));
  });

  it("emitWebhookEvent is a no-op without matches", async () => {
    const n = await emitWebhookEvent("w", "kb.ready", {});
    expect(n).toBe(0);
    expect(enqueueCalls).toHaveLength(0);
  });
});
