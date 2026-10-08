// F4 regression net (2026-09-30): tenant resolution + personal workspace.
//
// A self-registered account used to get NO workspace, so `resolveWorkspace`
// fell back to `ws_default`; because an unnamed KB defaults to "view" access,
// a brand-new user could read every non-private KB of the default org.
import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_WORKSPACE_ID,
  createWorkspace,
  ensurePersonalWorkspace,
  getDefaultWorkspace,
  listOwnedWorkspaces,
  listWorkspaces,
  resolveWorkspace,
  workspaceOf,
} from "./store";

const DEMO_EMAIL = "owner@knowledgeai.dev";
const NEW_EMAIL = "newbie@example.com";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_WORKSPACE_STORE__;
});

describe("workspace store bootstrap", () => {
  it("seeds the default workspace with the demo members", () => {
    const ws = getDefaultWorkspace();
    expect(ws.id).toBe(DEFAULT_WORKSPACE_ID);
    expect(ws.members).toContain(DEMO_EMAIL);
  });
});

describe("resolveWorkspace (F4)", () => {
  it("keeps an explicit member workspace", () => {
    const ws = resolveWorkspace("usr_owner", DEMO_EMAIL, DEFAULT_WORKSPACE_ID);
    expect(ws.id).toBe(DEFAULT_WORKSPACE_ID);
  });

  it("ignores an explicit workspace the user is not a member of", () => {
    const other = ensurePersonalWorkspace({
      ownerId: "usr_other",
      ownerEmail: "other@example.com",
      ownerName: "别人",
    })!;
    // The demo owner is not a member of the other user's workspace.
    const resolved = resolveWorkspace("usr_owner", DEMO_EMAIL, other.id);
    expect(resolved.id).not.toBe(other.id);
  });

  it("falls back to the default workspace for demo members", () => {
    expect(resolveWorkspace("usr_owner", DEMO_EMAIL).id).toBe(DEFAULT_WORKSPACE_ID);
    expect(resolveWorkspace("usr_viewer", "viewer@knowledgeai.dev").id).toBe(DEFAULT_WORKSPACE_ID);
  });

  it("keeps the default workspace for a member who ALSO owns another one", () => {
    // Regression: an earlier version of the F4 fix preferred "any owned
    // workspace", which silently moved every demo user (they create extra
    // workspaces during the acceptance run) out of ws_default whenever no
    // workspace cookie was present.
    createWorkspace({
      name: "额外工作区",
      ownerId: "usr_owner",
      ownerEmail: DEMO_EMAIL,
      ownerName: "张明",
    });
    expect(resolveWorkspace("usr_owner", DEMO_EMAIL).id).toBe(DEFAULT_WORKSPACE_ID);
    // ...but an explicitly requested, joined workspace still wins.
    const extra = listOwnedWorkspaces("usr_owner").find((w) => w.id !== DEFAULT_WORKSPACE_ID)!;
    expect(resolveWorkspace("usr_owner", DEMO_EMAIL, extra.id).id).toBe(extra.id);
  });

  it("prefers the user's OWN workspace over the shared default", () => {
    const personal = ensurePersonalWorkspace({
      ownerId: "usr_new",
      ownerEmail: NEW_EMAIL,
      ownerName: "新用户",
    })!;
    const resolved = resolveWorkspace("usr_new", NEW_EMAIL);
    expect(resolved.id).toBe(personal.id);
    expect(resolved.id).not.toBe(DEFAULT_WORKSPACE_ID);
  });

  it("a newly registered user is NOT a member of the default workspace", () => {
    ensurePersonalWorkspace({ ownerId: "usr_new", ownerEmail: NEW_EMAIL, ownerName: "新用户" });
    expect(workspaceOf(DEFAULT_WORKSPACE_ID, NEW_EMAIL)).toBe(false);
  });
});

describe("ensurePersonalWorkspace (F4)", () => {
  it("creates exactly one personal workspace", () => {
    const first = ensurePersonalWorkspace({
      ownerId: "usr_new",
      ownerEmail: NEW_EMAIL,
      ownerName: "新用户",
    });
    const second = ensurePersonalWorkspace({
      ownerId: "usr_new",
      ownerEmail: NEW_EMAIL,
      ownerName: "新用户",
    });
    expect(first).not.toBeNull();
    expect(second!.id).toBe(first!.id);
    expect(listOwnedWorkspaces("usr_new").length).toBe(1);
  });

  it("registers the owner as a member and names the workspace", () => {
    const ws = ensurePersonalWorkspace({
      ownerId: "usr_new",
      ownerEmail: "Newbie@Example.com",
      ownerName: "新用户",
    })!;
    expect(ws.members).toEqual(["newbie@example.com"]);
    expect(ws.plan).toBe("free");
    expect(ws.name).toBe("新用户 的工作区");
    expect(listWorkspaces("newbie@example.com").map((w) => w.id)).toContain(ws.id);
  });

  it("returns null without a usable email", () => {
    expect(ensurePersonalWorkspace({ ownerId: "usr_x", ownerEmail: "  " })).toBeNull();
  });
});
