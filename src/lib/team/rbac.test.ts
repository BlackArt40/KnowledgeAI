// P6-3 unit tests: team/rbac (pure permission matrix).
import { describe, it, expect } from "vitest";
import { ROLE_PERMS, can, ROLE_ORDER } from "./rbac";

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
    expect(can("editor", "nonsense.perm")).toBe(false);
  });

  it("role order is owner > admin > editor > viewer", () => {
    expect(ROLE_ORDER).toEqual(["owner", "admin", "editor", "viewer"]);
  });
});
