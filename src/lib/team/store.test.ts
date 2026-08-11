// P6-3 unit tests: team/store (members / roles / KB access inheritance).
import { describe, it, expect, beforeEach } from "vitest";
import {
  getTeam,
  updateTeam,
  listMembers,
  getMember,
  inviteMember,
  updateMemberRole,
  removeMember,
  listAudit,
  getKbAccess,
  setKbAccess,
  getKbMemberRole,
  setKbMemberRole,
  listKbMemberRoles,
  canViewKb,
  canEditKb,
} from "./store";
import { seed as seedUsers, findUserByEmail } from "@/lib/auth/store";

const OWNER_ID = "usr_owner";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_TEAM_STORE__;
  delete (globalThis as Record<string, unknown>).__KAI_USER_STORE__;
  seedUsers();
});

describe("team + members", () => {
  it("seeds a team with 8 members and audit trail", () => {
    expect(getTeam().name).toBe("KnowledgeAI 团队");
    expect(listMembers().length).toBe(8);
    expect(listAudit().length).toBeGreaterThan(0);
  });

  it("updateTeam patches name/logo/plan", () => {
    updateTeam({ name: "新团队", plan: "企业版" });
    expect(getTeam().name).toBe("新团队");
    expect(getTeam().plan).toBe("企业版");
  });

  it("inviteMember adds with role and audit entry", () => {
    const before = listMembers().length;
    const m = inviteMember({ name: "新人", email: "new@team.dev", role: "viewer" });
    expect(listMembers().length).toBe(before + 1);
    expect(getMember(m.id)?.status).toBe("invited");
    expect(listAudit()[0].action).toBe("邀请成员");
  });

  it("updateMemberRole changes roles and removeMember deletes", () => {
    const m = listMembers().find((x) => x.email === "viewer@knowledgeai.dev")!;
    updateMemberRole(m.id, "editor");
    expect(getMember(m.id)?.role).toBe("editor");
    expect(removeMember(m.id)).toBe(true);
    expect(getMember(m.id)).toBeUndefined();
    expect(removeMember("missing")).toBe(false);
  });
});

describe("KB access", () => {
  it("default access by KB name (财务报告 -> private)", () => {
    expect(getKbAccess("kb-fin", "财务报告")).toBe("private");
    expect(getKbAccess("kb-ops", "运维手册")).toBe("edit");
    expect(getKbAccess("kb-other", "产品文档")).toBe("view");
  });

  it("setKbAccess overrides defaults", () => {
    setKbAccess("kb-x", "edit");
    expect(getKbAccess("kb-x", "随便")).toBe("edit");
  });

  it("canViewKb: owner always, viewers denied on private KBs", () => {
    const viewer = findUserByEmail("viewer@knowledgeai.dev")!;
    expect(canViewKb("kb-fin", "财务报告", OWNER_ID, OWNER_ID)).toBe(true);
    expect(canViewKb("kb-fin", "财务报告", viewer.id, OWNER_ID)).toBe(false);
    expect(canViewKb("kb-ops", "运维手册", viewer.id, OWNER_ID)).toBe(true);
  });

  it("canEditKb: owner + edit access; viewer cannot edit", () => {
    const viewer = findUserByEmail("viewer@knowledgeai.dev")!;
    expect(canEditKb("kb-ops", "运维手册", OWNER_ID, OWNER_ID)).toBe(true);
    expect(canEditKb("kb-ops", "运维手册", viewer.id, OWNER_ID)).toBe(true);
    expect(canEditKb("kb-other", "产品文档", viewer.id, OWNER_ID)).toBe(false);
  });

  it("per-KB member roles override KB access (P4-2)", () => {
    const viewer = findUserByEmail("viewer@knowledgeai.dev")!;
    // grant viewer edit on a private KB -> can view AND edit
    setKbMemberRole("kb-fin", viewer.email, "editor");
    expect(getKbMemberRole("kb-fin", viewer.email)).toBe("editor");
    expect(canViewKb("kb-fin", "财务报告", viewer.id, OWNER_ID)).toBe(true);
    expect(canEditKb("kb-fin", "财务报告", viewer.id, OWNER_ID)).toBe(true);
    expect(listKbMemberRoles("kb-fin")).toHaveProperty(viewer.email);
    // revoke -> private again
    setKbMemberRole("kb-fin", viewer.email, null);
    expect(canViewKb("kb-fin", "财务报告", viewer.id, OWNER_ID)).toBe(false);
  });
});
