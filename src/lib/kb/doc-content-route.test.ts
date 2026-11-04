// P3 文档正文编辑：权限、乐观并发、空正文与租户边界。
import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueMock = vi.hoisted(() => vi.fn(async () => "job_1"));
vi.mock("@/lib/queue", () => ({ enqueue: enqueueMock }));

import { PUT as contentPUT } from "@/app/api/knowledge-base/[id]/documents/[docId]/content/route";
import { createToken } from "@/lib/auth/session";
import { seed as seedUsers } from "@/lib/auth/store";
import { addDocument, createKb, getDocument } from "@/lib/kb/store";
import type { Role } from "@/lib/roles";

const OWNER = { id: "usr_owner", email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "owner" as Role };
const VIEWER = { id: "usr_viewer", email: "viewer@knowledgeai.dev", name: "赵琳（Viewer）", role: "viewer" as Role };

async function cookieFor(user: typeof OWNER): Promise<string> {
  return `kai-token=${await createToken(user, 60)}`;
}
function putRequest(cookie: string, body: unknown): Request {
  return new Request("http://localhost/api/kb/doc/content", {
    method: "PUT",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string, docId: string) => ({ params: Promise.resolve({ id, docId }) });

function fixture() {
  const kb = createKb({ name: "文档编辑验收", desc: "" }, OWNER.id, "ws_default");
  const doc = addDocument({ kbId: kb.id, name: "note.md", size: 32, content: "# 初始", skipEnqueue: true });
  return { kb, doc };
}

beforeEach(() => {
  for (const key of ["__KAI_KB_STORE__", "__KAI_USER_STORE__", "__KAI_TEAM_STORE__", "__KAI_WORKSPACE_STORE__"]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  seedUsers();
  enqueueMock.mockClear();
});

describe("PUT document content", () => {
  it("owner 保存成功：version+1、内容更新、触发重切索引", async () => {
    const { kb, doc } = fixture();
    const res = await contentPUT(
      putRequest(await cookieFor(OWNER), { content: "# 新正文", baseVersion: 1 }),
      params(kb.id, doc.id)
    );
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { doc: { content: string; version: number; editedBy: string }; queued: boolean };
    expect(body.doc.content).toBe("# 新正文");
    expect(body.doc.version).toBe(2);
    expect(body.doc.editedBy).toBe(OWNER.name);
    expect(body.queued).toBe(true);
    expect(enqueueMock).toHaveBeenCalledWith("doc-process", { docId: doc.id });
    expect(getDocument(doc.id)?.content).toBe("# 新正文");
  });

  it("陈旧 baseVersion → 409 version_conflict，不覆盖正文", async () => {
    const { kb, doc } = fixture();
    await contentPUT(
      putRequest(await cookieFor(OWNER), { content: "第一版", baseVersion: 1 }),
      params(kb.id, doc.id)
    );
    const stale = await contentPUT(
      putRequest(await cookieFor(OWNER), { content: "过期覆盖", baseVersion: 1 }),
      params(kb.id, doc.id)
    );
    expect(stale!.status).toBe(409);
    await expect(stale!.json()).resolves.toMatchObject({
      code: "version_conflict",
      currentVersion: 2,
    });
    expect(getDocument(doc.id)?.content).toBe("第一版");
  });

  it("viewer 403；空正文 400；跨租户 403", async () => {
    const { kb, doc } = fixture();
    const viewer = await contentPUT(
      putRequest(await cookieFor(VIEWER), { content: "viewer 改写", baseVersion: 1 }),
      params(kb.id, doc.id)
    );
    expect(viewer!.status).toBe(403);

    const empty = await contentPUT(
      putRequest(await cookieFor(OWNER), { content: "   ", baseVersion: 1 }),
      params(kb.id, doc.id)
    );
    expect(empty!.status).toBe(400);

    const otherKb = createKb({ name: "别的工作区", desc: "" }, OWNER.id, "ws_other");
    const otherDoc = addDocument({
      kbId: otherKb.id,
      name: "other.md",
      size: 8,
      content: "别处",
      skipEnqueue: true,
    });
    const cross = await contentPUT(
      putRequest(await cookieFor(OWNER), { content: "越权", baseVersion: 1 }),
      params(otherKb.id, otherDoc.id)
    );
    expect(cross!.status).toBe(403);
  });
});
