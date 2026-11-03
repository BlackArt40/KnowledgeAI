// P6-3 unit tests: team/rbac (pure permission matrix).
import { describe, it, expect } from "vitest";
import {
  ROLE_PERMS,
  can,
  ROLE_ORDER,
  ROLE_RANK,
  isRole,
  outranks,
  assignableRoles,
  type Permission,
} from "./rbac";

describe("rbac matrix", () => {
  it("owner has every permission", () => {
    for (const perms of Object.values(ROLE_PERMS)) {
      for (const p of perms) expect(can("owner", p)).toBe(true);
    }
  });

  it("viewer only reads + chats", () => {
    expect(can("viewer", "kb.read")).toBe(true);
    expect(can("viewer", "kb.create")).toBe(false);
    expect(can("viewer", "agent.run")).toBe(false);
    expect(can("viewer", "member.invite")).toBe(false);
  });

  it("editor edits but cannot manage members or billing", () => {
    expect(can("editor", "kb.edit")).toBe(true);
    expect(can("editor", "kb.delete")).toBe(false);
    expect(can("editor", "member.manage")).toBe(false);
  });

  it("admin manages members but not billing", () => {
    expect(can("admin", "member.manage")).toBe(true);
    expect(can("admin", "billing.manage")).toBe(false);
    expect(can("admin", "kb.delete")).toBe(true);
  });

  it("unknown permissions return false", () => {
    expect(can("editor", "nonsense.perm" as Permission)).toBe(false);
  });

  it("role order is owner > admin > editor > viewer", () => {
    expect(ROLE_ORDER).toEqual(["owner", "admin", "editor", "viewer"]);
  });

  it("caps are inherited from the tier below (no hand-copied lists)", () => {
    const owned = new Set<Permission>(ROLE_PERMS.owner);
    for (const role of ROLE_ORDER) {
      for (const p of ROLE_PERMS[role]) expect(owned.has(p)).toBe(true);
    }
    for (const p of ROLE_PERMS.viewer) expect(can("editor", p)).toBe(true);
    for (const p of ROLE_PERMS.editor) expect(can("admin", p)).toBe(true);
    for (const p of ROLE_PERMS.admin) expect(can("owner", p)).toBe(true);
  });
});

describe("relative authority (who may manage whom)", () => {
  it("ranks are unique and strictly ordered", () => {
    const ranks = ROLE_ORDER.map((r) => ROLE_RANK[r]);
    expect(ranks).toEqual([0, 1, 2, 3]);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("only strictly lower roles are manageable", () => {
    expect(outranks("owner", "admin")).toBe(true);
    expect(outranks("owner", "viewer")).toBe(true);
    expect(outranks("admin", "editor")).toBe(true);
    expect(outranks("admin", "admin")).toBe(false);
    expect(outranks("admin", "owner")).toBe(false);
    expect(outranks("editor", "editor")).toBe(false);
    expect(outranks("editor", "viewer")).toBe(true);
    expect(outranks("viewer", "owner")).toBe(false);
  });

  it("assignable roles stop below the actor", () => {
    expect(assignableRoles("owner")).toEqual(["admin", "editor", "viewer"]);
    expect(assignableRoles("admin")).toEqual(["editor", "viewer"]);
    expect(assignableRoles("editor")).toEqual(["viewer"]);
    expect(assignableRoles("viewer")).toEqual([]);
  });

  it("isRole rejects unknown values", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("owner ")).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
