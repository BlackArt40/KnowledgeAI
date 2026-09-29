import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUser } from "@/lib/auth/guard";

// The routes resolve their caller through getRequestUser. This holder lets each
// case present a different identity/tenant without going near the session layer.
const { session } = vi.hoisted(() => ({
  session: { user: null as RequestUser | null },
}));

vi.mock("@/lib/auth/guard", () => ({
  getRequestUser: async () => session.user,
}));

import { PUT as putReport } from "@/app/api/agent/tasks/[id]/report/route";
import { POST as postComment } from "@/app/api/agent/tasks/[id]/comments/route";
import { DELETE as deleteComment } from "@/app/api/agent/tasks/[id]/comments/[cid]/route";
import { canAccessTask, createTask, getTask } from "@/lib/agent/store";

function requestUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: "usr_editor",
    email: "editor@knowledgeai.dev",
    name: "Editor",
    role: "editor",
    workspaceId: "ws_default",
    ...overrides,
  };
}

/** A task owned by `userId` in `workspaceId`; omit the owner to get the row
 *  shape that has no userId at all (the case the workspace fallback protects). */
function makeTask(opts: { userId?: string; workspaceId?: string } = {}) {
  return createTask(
    { topic: "加固测试", outputFormat: "report", agents: ["searcher"], maxSteps: 3 },
    opts.userId,
    opts.workspaceId ?? "ws_default"
  );
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Handlers must always answer; TS infers a `| undefined` arm for the routes
 *  that gate through a shared loadOwned union, so fail loudly instead of
 *  asserting on a value that may not exist. */
async function sent(res: Promise<Response | undefined>): Promise<Response> {
  const r = await res;
  if (!r) throw new Error("route handler returned no response");
  return r;
}

function reportRequest(id: string, report = "新报告") {
  return new Request(`http://localhost/api/agent/tasks/${id}/report`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ report }),
  });
}

function commentRequest(id: string, text = "跨租户评论") {
  return new Request(`http://localhost/api/agent/tasks/${id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

beforeEach(() => {
  session.user = null;
  delete (globalThis as Record<string, unknown>).__KAI_AGENT_STORE__;
});

describe("canAccessTask", () => {
  it("lets the owner through even from another workspace", () => {
    expect(
      canAccessTask({ userId: "u1", workspaceId: "ws_a" }, { id: "u1", workspaceId: "ws_b" })
    ).toBe(true);
  });

  it("lets a member of the task's workspace through", () => {
    expect(
      canAccessTask({ userId: "u1", workspaceId: "ws_a" }, { id: "u2", workspaceId: "ws_a" })
    ).toBe(true);
  });

  it("rejects a caller from another workspace when someone else owns the task", () => {
    expect(
      canAccessTask({ userId: "u1", workspaceId: "ws_a" }, { id: "u2", workspaceId: "ws_b" })
    ).toBe(false);
  });

  it("falls back to the workspace for a task with no userId", () => {
    expect(canAccessTask({ workspaceId: "ws_a" }, { id: "u2", workspaceId: "ws_a" })).toBe(true);
  });

  it("rejects a no-userId task from another workspace (the gap this closes)", () => {
    expect(canAccessTask({ workspaceId: "ws_a" }, { id: "u2", workspaceId: "ws_b" })).toBe(false);
  });
});

describe("agent task routes: workspace fallback (P4-3)", () => {
  it("rejects a cross-workspace caller on a userId-less task's report", async () => {
    const task = makeTask({ workspaceId: "ws_a" });
    session.user = requestUser({ id: "usr_admin", role: "admin", workspaceId: "ws_b" });
    const res = await putReport(reportRequest(task.id), params(task.id));
    expect(res.status).toBe(403);
    expect(getTask(task.id)?.report).toBeUndefined();
  });

  it("still lets a member of the task's workspace edit that report", async () => {
    const task = makeTask({ workspaceId: "ws_a" });
    session.user = requestUser({ id: "usr_mate", workspaceId: "ws_a" });
    const res = await putReport(reportRequest(task.id), params(task.id));
    expect(res.status).toBe(200);
    expect(getTask(task.id)?.report).toBe("新报告");
  });

  it("keeps letting the owner reach their task from another workspace", async () => {
    const task = makeTask({ userId: "usr_owner", workspaceId: "ws_a" });
    session.user = requestUser({ id: "usr_owner", workspaceId: "ws_b" });
    const res = await putReport(reportRequest(task.id), params(task.id));
    expect(res.status).toBe(200);
  });

  it("rejects a cross-workspace comment on a userId-less task", async () => {
    const task = makeTask({ workspaceId: "ws_a" });
    session.user = requestUser({ id: "usr_admin", role: "admin", workspaceId: "ws_b" });
    const res = await sent(postComment(commentRequest(task.id), params(task.id)));
    expect(res.status).toBe(403);
    expect(getTask(task.id)?.comments ?? []).toHaveLength(0);
  });

  it("rejects deleting a comment on a userId-less task from another workspace", async () => {
    const task = makeTask({ workspaceId: "ws_a" });
    session.user = requestUser({ id: "usr_mate", workspaceId: "ws_a" });
    const posted = await sent(postComment(commentRequest(task.id, "同租户评论"), params(task.id)));
    expect(posted.status).toBe(200);
    const { comment } = (await posted.json()) as { comment: { id: string } };

    session.user = requestUser({ id: "usr_admin", role: "admin", workspaceId: "ws_b" });
    const res = await sent(
      deleteComment(
        new Request(`http://localhost/api/agent/tasks/${task.id}/comments/${comment.id}`, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: task.id, cid: comment.id }) }
      )
    );
    expect(res.status).toBe(403);
    expect((getTask(task.id)?.comments ?? []).some((c) => c.id === comment.id)).toBe(true);
  });

  it("returns 401 for an anonymous caller", async () => {
    const task = makeTask({ workspaceId: "ws_a" });
    const res = await putReport(reportRequest(task.id), params(task.id));
    expect(res.status).toBe(401);
  });
});
