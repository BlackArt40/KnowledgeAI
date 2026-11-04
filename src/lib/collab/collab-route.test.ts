// Phase 2b: /collab 路由的权限、租户边界与 update 校验。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(async () => "job_collab") }));

import {
  GET as collabGET,
  POST as collabPOST,
} from "@/app/api/knowledge-base/[id]/documents/[docId]/collab/route";
import { addDocument, createKb } from "@/lib/kb/store";
import { destroyCollabState, flushCollabSnapshot } from "@/lib/collab/y-state";
import { createToken } from "@/lib/auth/session";
import { seed as seedUsers } from "@/lib/auth/store";
import type { Role } from "@/lib/roles";

const OWNER = { id: "usr_owner", email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "owner" as Role };
const VIEWER = { id: "usr_viewer", email: "viewer@knowledgeai.dev", name: "赵琳（Viewer）", role: "viewer" as Role };

async function cookieFor(user: typeof OWNER): Promise<string> {
  return `kai-token=${await createToken(user, 60)}`;
}
function req(cookie: string, method: string, body?: unknown): Request {
  return new Request("http://localhost/api/kb/doc/collab", {
    method,
    headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const params = (id: string, docId: string) => ({ params: Promise.resolve({ id, docId }) });

function fixture() {
  const kb = createKb({ name: "协同 API 验收", desc: "" }, OWNER.id, "ws_default");
  const doc = addDocument({ kbId: kb.id, name: "api.md", size: 5, content: "base", skipEnqueue: true });
  return { kb, doc };
}

beforeEach(() => {
  for (const key of [
    "__KAI_KB_STORE__",
    "__KAI_USER_STORE__",
    "__KAI_TEAM_STORE__",
    "__KAI_WORKSPACE_STORE__",
    "__KAI_COLLAB_STATE__",
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  seedUsers();
});
afterEach(() => vi.useRealTimers());

describe("/documents/[docId]/collab", () => {
  it("owner 引导成功；提交 update 后重新 GET 能读到合并结果", async () => {
    const { kb, doc } = fixture();
    const owner = await cookieFor(OWNER);

    const boot = await collabGET(req(owner, "GET"), params(kb.id, doc.id));
    expect(boot!.status).toBe(200);
    const bootBody = (await boot!.json()) as { update: string; vector: string; version: number };
    expect(bootBody.version).toBe(1);

    const client = new Y.Doc();
    Y.applyUpdate(client, new Uint8Array(Buffer.from(bootBody.update, "base64")));
    client.getText("content").insert(4, "!");
    const update = Buffer.from(Y.encodeStateAsUpdate(client)).toString("base64");

    const post = await collabPOST(req(owner, "POST", { update }), params(kb.id, doc.id));
    expect(post!.status).toBe(200);

    const boot2 = await collabGET(req(owner, "GET"), params(kb.id, doc.id));
    const boot2Body = (await boot2!.json()) as { update: string };
    const merged = new Y.Doc();
    Y.applyUpdate(merged, new Uint8Array(Buffer.from(boot2Body.update, "base64")));
    expect(merged.getText("content").toString()).toBe("base!");

    flushCollabSnapshot(doc.id);
    destroyCollabState(doc.id);
  });

  it("viewer 可读不可写；非法 update 400；跨租户 403", async () => {
    const { kb, doc } = fixture();
    const owner = await cookieFor(OWNER);
    const viewer = await cookieFor(VIEWER);

    expect((await collabGET(req(viewer, "GET"), params(kb.id, doc.id)))!.status).toBe(200);
    expect(
      (await collabPOST(req(viewer, "POST", { update: "AAAA" }), params(kb.id, doc.id)))!.status
    ).toBe(403);
    expect(
      (await collabPOST(req(owner, "POST", { update: "!!!" }), params(kb.id, doc.id)))!.status
    ).toBe(400);
    expect(
      (await collabPOST(req(owner, "POST", { update: "" }), params(kb.id, doc.id)))!.status
    ).toBe(400);

    const other = createKb({ name: "别处", desc: "" }, OWNER.id, "ws_other");
    const otherDoc = addDocument({
      kbId: other.id,
      name: "x.md",
      size: 1,
      content: "x",
      skipEnqueue: true,
    });
    expect(
      (await collabGET(req(owner, "GET"), params(other.id, otherDoc.id)))!.status
    ).toBe(403);
  });
});
