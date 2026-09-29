import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUser } from "@/lib/auth/guard";

// The route resolves its caller through getRequestUser. This holder lets each
// case present a different tenant/role without going near the session layer.
const { session } = vi.hoisted(() => ({
  session: { user: null as RequestUser | null },
}));

vi.mock("@/lib/auth/guard", () => ({
  getRequestUser: async () => session.user,
}));

import { PATCH } from "@/app/api/team/kb-access/route";
import { createKb } from "@/lib/kb/store";
import { getKbAccess } from "@/lib/team/store";
import { DEFAULT_WORKSPACE_ID } from "@/lib/workspace/store";

function requestUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: "usr_admin",
    email: "admin@knowledgeai.dev",
    name: "Admin",
    role: "admin",
    workspaceId: DEFAULT_WORKSPACE_ID,
    ...overrides,
  };
}

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/team/kb-access", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("PATCH /api/team/kb-access", () => {
  beforeEach(() => {
    // Pre-arm an empty, already-seeded KB store: seed() only bails out on the
    // `seeded` flag, and its demo documents sit in "parsing"/"vectorizing"
    // state, which makes it fire startProcessing() -> `import("@/lib/queue")`.
    // That fire-and-forget import lands after this file's environment is torn
    // down (queue/index.ts statically pulls in the BullMQ backend) and logs a
    // spurious EnvironmentTeardownError as "[kb] failed to enqueue
    // doc-process". The route under test only needs getKb/createKb, so keeping
    // the store real but seed-free keeps the run hermetic and quiet.
    (globalThis as unknown as { __KAI_KB_STORE__?: unknown }).__KAI_KB_STORE__ = {
      kbs: new Map(),
      docs: new Map(),
      seeded: true,
    };
    delete (globalThis as Record<string, unknown>).__KAI_TEAM_STORE__;
    session.user = null;
  });

  it("rejects an admin of another workspace (cross-tenant access change)", async () => {
    const kb = createKb({ name: "tenant-check-kb", desc: "" }, "usr_owner", DEFAULT_WORKSPACE_ID);
    session.user = requestUser({ workspaceId: "ws_other" });

    const res = await patch({ kbId: kb.id, access: "edit" });

    expect(res.status).toBe(403);
    // The owning workspace keeps its original shared access.
    expect(getKbAccess(kb.id, kb.name)).toBe("view");
  });

  it("still lets an admin of the KB's own workspace change the shared access", async () => {
    const kb = createKb({ name: "tenant-check-kb-same", desc: "" }, "usr_owner", DEFAULT_WORKSPACE_ID);
    session.user = requestUser();

    const res = await patch({ kbId: kb.id, access: "edit" });

    expect(res.status).toBe(200);
    expect(getKbAccess(kb.id, kb.name)).toBe("edit");
  });

  it("rejects a role without member.manage", async () => {
    const kb = createKb({ name: "tenant-check-kb-editor", desc: "" }, "usr_owner", DEFAULT_WORKSPACE_ID);
    session.user = requestUser({ id: "usr_editor", role: "editor" });

    expect((await patch({ kbId: kb.id, access: "edit" })).status).toBe(403);
    expect(getKbAccess(kb.id, kb.name)).toBe("view");
  });

  it("keeps the member-role branch owner-only", async () => {
    const kb = createKb({ name: "tenant-check-kb-role", desc: "" }, "usr_owner", DEFAULT_WORKSPACE_ID);
    session.user = requestUser(); // admin, same workspace, but not the KB owner

    const res = await patch({ kbId: kb.id, email: "viewer@knowledgeai.dev", role: "editor" });

    expect(res.status).toBe(403);
  });

  it("returns 401 for an anonymous caller", async () => {
    const kb = createKb({ name: "tenant-check-kb-anon", desc: "" }, "usr_owner", DEFAULT_WORKSPACE_ID);

    expect((await patch({ kbId: kb.id, access: "edit" })).status).toBe(401);
  });
});
