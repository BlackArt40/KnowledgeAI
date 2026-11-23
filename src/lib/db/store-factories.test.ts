import { describe, expect, it } from "vitest";
import {
  createEmptyAdminStore,
  createEmptyAuthStore,
  createEmptyBillingStore,
  createEmptyTeamStore,
  createEmptyWorkspaceStore,
} from "./store-factories";

describe("store factories", () => {
  it("returns fresh mutable state per call", () => {
    const a = createEmptyAuthStore();
    const b = createEmptyAuthStore();
    a.users.set("u1", { id: "u1" } as never);
    expect(b.users.size).toBe(0);
    expect(a.emailIndex).not.toBe(b.emailIndex);
  });

  it("keeps the DB-authoritative billing seed distinct from the demo seed", () => {
    expect(createEmptyBillingStore().seeded).toBe(false);
    expect(createEmptyBillingStore(true).seeded).toBe(true);
  });

  it("seeds the default workspace and team shells", () => {
    const ws = createEmptyWorkspaceStore();
    expect(ws.get("ws_default")).toMatchObject({
      id: "ws_default",
      ownerId: "usr_owner",
      plan: "pro",
      brandColor: "indigo",
    });
    expect(createEmptyTeamStore().team).toMatchObject({
      id: "team_default",
      plan: "专业版",
    });
  });

  it("admin config is complete enough for 2FA policy reads", () => {
    expect(createEmptyAdminStore().config.required2FARoles).toEqual([]);
    expect(createEmptyAdminStore().config.rateLimitPerMin).toBeGreaterThan(0);
  });
});
