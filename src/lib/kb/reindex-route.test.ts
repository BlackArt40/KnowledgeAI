// POST /api/knowledge-base/[id]/documents/[docId]/reindex 与整库重建的回归网：
// 正文在库、向量缺失（pgvector 故障期上传）时不必重传，跑一次重建即可。
import { beforeEach, describe, expect, it, vi } from "vitest";

// 带参签名：KB seed 会为演示文档异步补投 doc-process，测试需要按 docId 区分
const enqueueMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => "job_1")
);

vi.mock("@/lib/queue", () => ({
  enqueue: enqueueMock,
}));

import { POST as reindexDocPOST } from "@/app/api/knowledge-base/[id]/documents/[docId]/reindex/route";
import { POST as reindexKbPOST } from "@/app/api/knowledge-base/[id]/reindex/route";
import { createToken } from "@/lib/auth/session";
import { seed as seedUsers } from "@/lib/auth/store";
import { addDocument, createKb, getDocument } from "@/lib/kb/store";
import type { Role } from "@/lib/roles";

const OWNER = { id: "usr_owner", email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "owner" as Role };
const VIEWER = { id: "usr_viewer", email: "viewer@knowledgeai.dev", name: "赵琳（Viewer）", role: "viewer" as Role };

async function cookieFor(user: typeof OWNER): Promise<string> {
  return `kai-token=${await createToken(user, 60)}`;
}

const docParams = (id: string, docId: string) => ({ params: Promise.resolve({ id, docId }) });
const kbParams = (id: string) => ({ params: Promise.resolve({ id }) });

function req(cookie: string, path: string): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { cookie } });
}

function newKb(): string {
  const kb = createKb({ name: "重建索引测试库", desc: "" }, OWNER.id);
  return kb.id;
}

/** addDocument 的初始状态是 queued；测试里需要的「已完成」文档手动置 ready。 */
function readyDoc(kbId: string, name: string, content?: string) {
  const doc = addDocument({ kbId, name, size: 10, content, skipEnqueue: true });
  const d = getDocument(doc.id)!;
  d.status = content ? "ready" : "failed";
  d.chunks = content ? 3 : 0;
  d.progress = content ? 100 : 0;
  return d;
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_KB_STORE__;
  delete (globalThis as Record<string, unknown>).__KAI_USER_STORE__;
  seedUsers();
  enqueueMock.mockClear();
  enqueueMock.mockImplementation(async () => "job_1");
});

describe("POST /api/knowledge-base/[id]/documents/[docId]/reindex", () => {
  it("未登录 401；viewer 无编辑权限 403", async () => {
    const kbId = newKb();
    const doc = readyDoc(kbId, "a.txt", "正文");

    const anon = await reindexDocPOST(req("", "/x"), docParams(kbId, doc.id));
    expect(anon.status).toBe(401);

    const viewer = await reindexDocPOST(
      req(await cookieFor(VIEWER), "/x"),
      docParams(kbId, doc.id)
    );
    expect(viewer.status).toBe(403);
  });

  it("正文缺失 422；已在处理中 409", async () => {
    const kbId = newKb();
    const owner = await cookieFor(OWNER);
    const empty = readyDoc(kbId, "empty.txt");
    expect(
      (await reindexDocPOST(req(owner, "/x"), docParams(kbId, empty.id))).status
    ).toBe(422);

    const busy = readyDoc(kbId, "busy.txt", "x");
    busy.status = "chunking";
    expect(
      (await reindexDocPOST(req(owner, "/x"), docParams(kbId, busy.id))).status
    ).toBe(409);
  });

  it("复位为 queued 并投递 doc-process 任务", async () => {
    const kbId = newKb();
    const doc = readyDoc(kbId, "a.txt", "正文");
    doc.chunks = 12;

    const res = await reindexDocPOST(req(await cookieFor(OWNER), "/x"), docParams(kbId, doc.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { queued: boolean; doc: { status: string; chunks: number } };
    expect(body.queued).toBe(true);
    expect(body.doc.status).toBe("queued");
    expect(body.doc.chunks).toBe(0);
    expect(enqueueMock).toHaveBeenCalledWith("doc-process", { docId: doc.id });
  });

  it("入队失败时标记 error 并返回 503", async () => {
    const kbId = newKb();
    const doc = readyDoc(kbId, "a.txt", "正文");
    // KB seed 会为演示文档异步补投 doc-process（startProcessing），
    // 所以断言只能按 docId 过滤，不能依赖全局调用顺序
    enqueueMock.mockImplementation(async (...args: unknown[]) => {
      const payload = args[1] as { docId?: string } | undefined;
      if (payload?.docId === doc.id) throw new Error("queue busy");
      return "job_1";
    });

    const res = await reindexDocPOST(req(await cookieFor(OWNER), "/x"), docParams(kbId, doc.id));
    expect(res.status).toBe(503);
    expect(getDocument(doc.id)!.status).toBe("failed");
  });
});

describe("POST /api/knowledge-base/[id]/reindex（整库）", () => {
  it("只重建有正文且不在处理中的文档，并统计跳过数", async () => {
    const kbId = newKb();
    const owner = await cookieFor(OWNER);
    const a = readyDoc(kbId, "a.txt", "正文 A");
    const b = readyDoc(kbId, "b.txt", "正文 B");
    readyDoc(kbId, "no-content.txt");

    const res = await reindexKbPOST(req(owner, "/x"), kbParams(kbId));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ queued: 2, skipped: 1, failed: 0, total: 3 });
    // seed 的后台补投会混进 mock 调用，按本库文档 id 过滤后应恰好 2 次
    const ids = [a.id, b.id];
    const mine = enqueueMock.mock.calls.filter(
      (c) => ids.includes(String((c[1] as { docId?: string } | undefined)?.docId))
    );
    expect(mine).toHaveLength(2);
  });

  it("viewer 整库重建 403", async () => {
    const kbId = newKb();
    const res = await reindexKbPOST(req(await cookieFor(VIEWER), "/x"), kbParams(kbId));
    expect(res.status).toBe(403);
  });
});
