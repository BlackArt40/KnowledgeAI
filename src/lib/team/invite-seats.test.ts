// Pending-invite seat cache: reserve / hydrate / release / expiry.
// The DB write-through is a no-op without DATABASE_URL; the cache contract is
// what routes read, so it is what these tests pin down.
import { beforeEach, describe, expect, it } from "vitest";
import {
  hydrateInviteReservation,
  listPendingInviteEmails,
  pendingInviteCount,
  releaseInviteSeat,
  reserveInviteSeat,
} from "./invite-seats";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_INVITE_SEATS__;
});

describe("pending invite seat reservations", () => {
  it("reserve 增加、release 释放，按工作区隔离", () => {
    reserveInviteSeat("ws_a", "a@test.local", "viewer", Date.now() + 60_000);
    reserveInviteSeat("ws_b", "b@test.local", "editor", Date.now() + 60_000);
    expect(pendingInviteCount("ws_a")).toBe(1);
    expect(pendingInviteCount("ws_b")).toBe(1);

    releaseInviteSeat("ws_a", "A@TEST.LOCAL");
    expect(pendingInviteCount("ws_a")).toBe(0);
    expect(listPendingInviteEmails("ws_b")).toEqual(["b@test.local"]);
  });

  it("hydrate 只恢复未过期的行（跨重启的强一致入口）", () => {
    hydrateInviteReservation({
      workspaceId: "ws_a",
      email: "live@test.local",
      role: "viewer",
      expiresAt: Date.now() + 60_000,
    });
    hydrateInviteReservation({
      workspaceId: "ws_a",
      email: "expired@test.local",
      role: "viewer",
      expiresAt: Date.now() - 1,
    });
    expect(listPendingInviteEmails("ws_a")).toEqual(["live@test.local"]);
  });

  it("过期条目会被计数时清理", () => {
    reserveInviteSeat("ws_a", "old@test.local", "viewer", Date.now() - 1);
    expect(pendingInviteCount("ws_a")).toBe(0);
  });
});
