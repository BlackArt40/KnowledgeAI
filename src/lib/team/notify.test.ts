import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/store", () => ({
  findUserByEmail: vi.fn(),
  getUserById: vi.fn(),
}));
vi.mock("@/lib/notifications/store", () => ({
  notify: vi.fn(() => ({ id: "ntf_1" })),
}));
vi.mock("./store", () => ({
  listMembers: vi.fn(),
}));

import { findUserByEmail, getUserById } from "@/lib/auth/store";
import { notify } from "@/lib/notifications/store";
import { listMembers } from "./store";
import {
  notifyKbOwner,
  notifyManagers,
  notifyMember,
  notifyTeam,
  notifyUserId,
  roleLabel,
} from "./notify";
import type { Member } from "./types";

const byEmail = vi.mocked(findUserByEmail);
const byId = vi.mocked(getUserById);
const send = vi.mocked(notify);
const members = vi.mocked(listMembers);

function member(over: Partial<Member> = {}): Member {
  return {
    id: "m_1",
    name: "张明",
    email: "owner@knowledgeai.dev",
    role: "owner",
    status: "active",
    lastActiveAt: 0,
    joinedAt: 0,
    ...over,
  };
}

beforeEach(() => {
  byEmail.mockReset();
  byId.mockReset();
  send.mockClear();
  members.mockReset();
});

describe("roleLabel", () => {
  it("maps known roles and falls back to the raw value", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("editor")).toBe("Editor");
    expect(roleLabel("custom")).toBe("custom");
  });
});

describe("notifyUserId / notifyMember", () => {
  it("notifies an existing account and skips the actor", () => {
    byEmail.mockReturnValue({ id: "usr_1" } as never);
    expect(notifyMember("a@b.dev", { title: "t", body: "b" })).toEqual({ id: "ntf_1" });
    expect(send).toHaveBeenCalledWith("usr_1", "teamActivity", "t", "b", undefined);

    notifyUserId("usr_1", { title: "t", body: "b" }, { exceptUserId: "usr_1" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("no-ops for accounts that do not exist", () => {
    byEmail.mockReturnValue(null);
    expect(notifyMember("ghost@b.dev", { title: "t", body: "b" })).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("notifyTeam / notifyManagers", () => {
  it("notifies active members once per account", () => {
    members.mockReturnValue([
      member({ email: "a@b.dev" }),
      member({ id: "m_2", email: "a@b.dev" }),
      member({ id: "m_3", email: "suspended@b.dev", status: "suspended" }),
    ]);
    byEmail.mockReturnValue({ id: "usr_1" } as never);
    expect(notifyTeam({ title: "t", body: "b" })).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("notifies owners/admins only", () => {
    members.mockReturnValue([
      member(),
      member({ id: "m_2", email: "admin@b.dev", role: "admin" }),
      member({ id: "m_3", email: "editor@b.dev", role: "editor" }),
    ]);
    byEmail.mockImplementation((email) => ({ id: `usr_${email}` }) as never);
    expect(notifyManagers({ title: "t", body: "b" })).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("notifyKbOwner", () => {
  it("resolves the owner account and skips when it is the actor", () => {
    byId.mockReturnValue({ id: "usr_owner" } as never);
    notifyKbOwner("usr_owner", { title: "t", body: "b" });
    expect(send).toHaveBeenCalledWith("usr_owner", "teamActivity", "t", "b", undefined);

    send.mockClear();
    notifyKbOwner("usr_owner", { title: "t", body: "b" }, { exceptUserId: "usr_owner" });
    expect(send).not.toHaveBeenCalled();
  });
});
