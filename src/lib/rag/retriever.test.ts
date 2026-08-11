// P6-3 unit tests: rag/retriever (full in-memory pipeline, demo mode).
import { describe, it, expect, beforeAll } from "vitest";
import { indexDocument } from "./indexer";
import { retrieve } from "./retriever";
import { clearBM25Kb } from "./bm25";
import type { KbDocument, KbSettings } from "@/lib/kb/types";

const KB = "retriever-test-kb";
const settings: KbSettings = { chunkSize: 200, chunkOverlap: 20, embeddingModel: "local", topK: 3 };

function doc(id: string, content: string): KbDocument {
  return {
    id,
    kbId: KB,
    name: `${id}.md`,
    type: "markdown",
    size: content.length,
    status: "ready",
    progress: 100,
    chunks: 0,
    content,
    uploadedAt: Date.now(),
  };
}

beforeAll(async () => {
  clearBM25Kb(KB);
  await indexDocument(
    doc("doc-a", "# 向量检索\n\n向量检索结合语义嵌入与 BM25 关键词。KnowledgeAI 使用混合检索提升精度。"),
    settings
  );
  await indexDocument(
    doc("doc-b", "# 文档解析\n\n系统支持 PDF、Word、Markdown 等多种格式的文档解析与切片。"),
    settings
  );
});

describe("retrieve (memory vector store + BM25)", () => {
  it("returns top-K relevant chunks for a matching query", async () => {
    const results = await retrieve(KB, "向量检索怎么做", 3);
    expect(results.length).toBeGreaterThan(0);
    const ids = new Set(results.map((r) => r.docId));
    expect(ids.has("doc-a")).toBe(true);
    for (const r of results) {
      expect(r).toHaveProperty("docId");
      expect(typeof r.text).toBe("string");
      expect(r.text.length).toBeGreaterThan(0);
    }
  });

  it("matches the other document for its own keywords", async () => {
    const results = await retrieve(KB, "PDF 文档解析", 3);
    const ids = new Set(results.map((r) => r.docId));
    expect(ids.has("doc-b")).toBe(true);
  });

  it("returns [] for an unknown KB", async () => {
    const results = await retrieve("no-such-kb", "anything", 3);
    expect(results).toEqual([]);
  });

  it("respects topK", async () => {
    const results = await retrieve(KB, "检索 解析 向量", 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
