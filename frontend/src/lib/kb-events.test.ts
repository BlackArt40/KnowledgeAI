import { describe, expect, it } from "vitest";
import { applyKbEvent, type LiveKbDoc } from "./kb-events";

interface Doc extends LiveKbDoc {
  name: string;
  progress?: number;
}

const docs: Doc[] = [
  { id: "d1", name: "a.pdf", status: "queued", progress: 0 },
  { id: "d2", name: "b.md", status: "ready" },
];

describe("applyKbEvent", () => {
  it("docs：新文档插入到列表首位，重复帧不重复插入", () => {
    const incoming = { id: "d3", name: "c.txt", status: "queued" };
    const first = applyKbEvent(docs, { type: "docs", doc: incoming });
    expect(first.docs.map((d) => d.id)).toEqual(["d3", "d1", "d2"]);
    expect(first.refresh).toBe(false);

    const second = applyKbEvent(first.docs, { type: "docs", doc: incoming });
    expect(second.docs).toBe(first.docs);
  });

  it("doc_status：进度帧就地更新，进入终态才要求刷新", () => {
    const mid = applyKbEvent(docs, { type: "doc_status", docId: "d1", status: "parsing", progress: 40 });
    expect(mid.docs[0]).toMatchObject({ id: "d1", status: "parsing", progress: 40 });
    expect(mid.refresh).toBe(false);
    expect(docs[0].status).toBe("queued"); // 原数组不被修改

    const done = applyKbEvent(mid.docs, { type: "doc_status", docId: "d1", status: "ready", progress: 100 });
    expect(done.refresh).toBe(true);
    expect(done.docs[0].status).toBe("ready");
  });

  it("doc_deleted：移除文档并要求刷新统计", () => {
    const r = applyKbEvent(docs, { type: "doc_deleted", docId: "d2" });
    expect(r.docs.map((d) => d.id)).toEqual(["d1"]);
    expect(r.refresh).toBe(true);
    expect(r.deleted).toBe(false);
  });

  it("settings / doc_access：不改文档，但要求刷新", () => {
    for (const type of ["settings", "doc_access"]) {
      const r = applyKbEvent(docs, { type, docId: "d1" });
      expect(r.docs).toBe(docs);
      expect(r.refresh).toBe(true);
    }
  });

  it("deleted：整库删除标记", () => {
    const r = applyKbEvent(docs, { type: "deleted" });
    expect(r.deleted).toBe(true);
    expect(r.docs).toBe(docs);
  });

  it("未知事件与 init 都是 no-op", () => {
    for (const type of ["init", "whatever"]) {
      const r = applyKbEvent(docs, { type });
      expect(r).toMatchObject({ refresh: false, deleted: false });
      expect(r.docs).toBe(docs);
    }
  });
});
