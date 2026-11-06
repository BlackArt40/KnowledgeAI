// P0 (batch 1): workspace resolution is the tenant boundary every request
// crosses — each fallback step in resolveWorkspace() is asserted here so a
// reorder cannot silently move a user into another tenant (the F4 bug class).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKSPACE_ID,
  addWorkspaceMember,
  createWorkspace,
  deleteWorkspacesOwnedBy,
  effectiveWorkspacePlan,
  getDefaultWorkspace,
  listOwnedWorkspaces,
  listWorkspaces,
  removeMemberEverywhere,
  resolveWorkspace,
  setWorkspacePlan,
  updateWorkspace,
  workspaceOf,
} from "./store";

const STORE_KEY = "__KAI_WORKSPACE_STORE__";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>)[STORE_KEY];
});

describe("resolveWorkspace", () => {
  it("honours an explicitly requested workspace the user belongs to", () => {
    const ws = createWorkspace({
      name: "市场部",
      ownerId: "usr_owner",
      ownerEmail: "owner@knowledgeai.dev",
      ownerName: "张明",
    });

    expect(resolveWorkspace("usr_owner", "owner@knowledgeai.dev", ws.id).id).toBe(ws.id);
  });

  it("ignores a requested workspace the user is not a member of", () => {
    const foreign = createWorkspace({
      name: "外部租户",
      ownerId: "usr_admin",
      ownerEmail: "admin@knowledgeai.dev",
      ownerName: "李芳",
    });

    const resolved = resolveWorkspace("usr_owner", "owner@knowledgeai.dev", foreign.id);
    expect(resolved.id).toBe(DEFAULT_WORKSPACE_ID);
  });

  it("prefers the default workspace over a workspace the user owns", () => {
    // F4: demo users keep resolving to ws_default when no cookie is present,
    // even after creating their own workspace.
    const own = createWorkspace({
      name: "我的空间",
      ownerId: "usr_owner",
      ownerEmail: "owner@knowledgeai.dev",
      ownerName: "张明",
    });

    const resolved = resolveWorkspace("usr_owner", "owner@knowledgeai.dev");
    expect(resolved.id).toBe(DEFAULT_WORKSPACE_ID);
    expect(resolved.id).not.toBe(own.id);
  });

  it("falls back to a workspace the user owns when they are outside the default", () => {
    const mine = createWorkspace({
      name: "独立租户",
      ownerId: "usr_solo",
      ownerEmail: "solo@example.com",
      ownerName: "Solo",
    });

    expect(resolveWorkspace("usr_solo", "solo@example.com").id).toBe(mine.id);
  });

  it("falls back to a workspace the user is a member of", () => {
    const team = createWorkspace({
      name: "客户团队",
      ownerId: "usr_admin",
      ownerEmail: "admin@knowledgeai.dev",
      ownerName: "李芳",
    });
    addWorkspaceMember(team.id, "guest@example.com");

    expect(resolveWorkspace("usr_guest", "guest@example.com").id).toBe(team.id);
  });

  it("falls back to the default workspace when the user belongs nowhere", () => {
    // This is the last-resort branch: a brand-new account still gets a tenant.
    expect(resolveWorkspace("usr_ghost", "ghost@example.com").id).toBe(DEFAULT_WORKSPACE_ID);
  });
});

describe("workspace queries", () => {
  it("lists the workspaces a user belongs to, newest first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const older = createWorkspace({
      name: "早期空间",
      ownerId: "usr_owner",
      ownerEmail: "owner@knowledgeai.dev",
      ownerName: "张明",
    });
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    const newer = createWorkspace({
      name: "新建空间",
      ownerId: "usr_owner",
      ownerEmail: "owner@knowledgeai.dev",
      ownerName: "张明",
    });

    const list = listWorkspaces("owner@knowledgeai.dev");
    expect(list.map((w) => w.id)).toEqual([newer.id, older.id, DEFAULT_WORKSPACE_ID]);
    vi.useRealTimers();
  });

  it("lists the workspaces a user owns", () => {
    const mine = createWorkspace({
      name: "我的租户",
      ownerId: "usr_solo",
      ownerEmail: "solo@example.com",
      ownerName: "Solo",
    });

    expect(listOwnedWorkspaces("usr_solo").map((w) => w.id)).toEqual([mine.id]);
    // The seeded default tenant is owned by the demo owner.
    expect(listOwnedWorkspaces("usr_owner").map((w) => w.id)).toEqual([DEFAULT_WORKSPACE_ID]);
    expect(listOwnedWorkspaces("usr_nobody")).toEqual([]);
  });

  it("answers membership per workspace", () => {
    expect(workspaceOf(DEFAULT_WORKSPACE_ID, "viewer@knowledgeai.dev")).toBe(true);
    expect(workspaceOf(DEFAULT_WORKSPACE_ID, "ghost@example.com")).toBe(false);
    expect(workspaceOf("ws_missing", "viewer@knowledgeai.dev")).toBe(false);
  });

  it("updates plan and brand colour", () => {
    expect(setWorkspacePlan(DEFAULT_WORKSPACE_ID, "enterprise")?.plan).toBe("enterprise");
    expect(updateWorkspace(DEFAULT_WORKSPACE_ID, { brandColor: "#123456" })?.brandColor).toBe("#123456");
    expect(setWorkspacePlan("ws_missing", "pro")).toBeUndefined();
    expect(updateWorkspace("ws_missing", { brandColor: "#000000" })).toBeUndefined();
  });

  it("resolves the plan from the kai-workspace cookie", () => {
    const own = createWorkspace({
      name: "自建空间",
      ownerId: "usr_owner",
      ownerEmail: "owner@knowledgeai.dev",
      ownerName: "张明",
    });
    setWorkspacePlan(own.id, "enterprise");

    const req = new Request("http://localhost/x", { headers: { cookie: `kai-workspace=${own.id}` } });
    expect(effectiveWorkspacePlan(req, { id: "usr_owner", email: "owner@knowledgeai.dev" })).toBe("enterprise");

    const noCookie = new Request("http://localhost/x");
    expect(effectiveWorkspacePlan(noCookie, { id: "usr_owner", email: "owner@knowledgeai.dev" })).toBe("pro");
  });
});

describe("workspace housekeeping", () => {
  it("never deletes the default workspace", () => {
    const own = createWorkspace({
      name: "临时",
      ownerId: "usr_owner",
      ownerEmail: "owner@knowledgeai.dev",
      ownerName: "张明",
    });

    const removed = deleteWorkspacesOwnedBy("usr_owner");

    expect(removed).toBe(1);
    expect(getDefaultWorkspace().id).toBe(DEFAULT_WORKSPACE_ID);
    expect(resolveWorkspace("usr_owner", "owner@knowledgeai.dev").id).toBe(DEFAULT_WORKSPACE_ID);
    expect(own.id).not.toBe(DEFAULT_WORKSPACE_ID);
  });

  it("removes a deleted member from every workspace", () => {
    const team = createWorkspace({
      name: "客户团队",
      ownerId: "usr_admin",
      ownerEmail: "admin@knowledgeai.dev",
      ownerName: "李芳",
      memberEmails: ["viewer@knowledgeai.dev"],
    });

    const touched = removeMemberEverywhere("viewer@knowledgeai.dev");

    expect(touched).toBe(2); // ws_default + the new team
    expect(getDefaultWorkspace().members).not.toContain("viewer@knowledgeai.dev");
    expect(resolveWorkspace("usr_viewer", "viewer@knowledgeai.dev").id).toBe(DEFAULT_WORKSPACE_ID);
    expect(team.members).not.toContain("viewer@knowledgeai.dev");
  });
});
