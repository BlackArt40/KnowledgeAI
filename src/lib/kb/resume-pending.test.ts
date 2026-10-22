// B3 回归网：种子文档以 queued 落库（无向量），应用水合后必须重投，
// 否则演示库永远没有切片、问答检索为空。
//
// 说明：不断言队列调用。startProcessing() 内部是动态 import 队列模块，
// vitest 下动态 import 会拿到模块的另一份实例，mock 拦不住（早期用
// vi.mock("@/lib/queue") 断言 enqueue 调用，实测只统计到 1 次且与真实
// 模块行为混杂）。这里改为断言「重投集合 == 未完成文档集合」——这是本函数
// 的唯一契约，队列去重由 MemoryQueue/BullMQ 各自的 jobId 保证（另有单测）。
import { beforeEach, describe, expect, it } from "vitest";
import {
  addDocument,
  createKb,
  getDocument,
  listAllKbs,
  listDocuments,
  resumePendingDocs,
} from "@/lib/kb/store";

const PENDING = ["queued", "parsing", "vectorizing"];

function allDocs() {
  return listAllKbs().flatMap((kb) => listDocuments(kb.id));
}

function pendingCount(): number {
  return allDocs().filter((d) => PENDING.includes(d.status)).length;
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_KB_STORE__;
});

describe("resumePendingDocs", () => {
  it("重投数量等于未完成文档数（queued/parsing/vectorizing），不含 ready/failed", () => {
    const kbId = createKb({ name: "重投测试库", desc: "" }, "usr_owner").id;
    const mk = (name: string, status: string) => {
      const doc = addDocument({ kbId, name, size: 10, content: "x", skipEnqueue: true });
      getDocument(doc.id)!.status = status as never;
      return doc;
    };
    mk("queued.md", "queued");
    mk("parsing.md", "parsing");
    mk("vectorizing.md", "vectorizing");
    mk("ready.md", "ready");
    mk("failed.md", "failed");

    const before = pendingCount();
    expect(before).toBeGreaterThanOrEqual(3);
    expect(resumePendingDocs()).toBe(before);
  });

  it("全部就绪时返回 0（幂等，不会反复重投）", () => {
    for (const doc of allDocs()) getDocument(doc.id)!.status = "ready";
    expect(pendingCount()).toBe(0);
    expect(resumePendingDocs()).toBe(0);
  });
});
