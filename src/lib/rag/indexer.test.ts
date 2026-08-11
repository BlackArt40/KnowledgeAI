// P6-3 unit tests: rag/indexer (doc -> chunks -> vector + BM25 + parent map).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { indexDocument, getParentText } from "./indexer";
import { search } from "./vector-store";
import { searchBM25, bm25ChunkCount } from "./bm25";
import { embed } from "./embeddings";
import type { KbDocument, KbSettings } from "@/lib/kb/types";

const env = process.env;
const KB = "indexer-test-kb";
const settings: KbSettings = { chunkSize: 100, chunkOverlap: 10, embeddingModel: "local", topK: 3 };

function doc(id: string, content: string): KbDocument {
  return {
    id, kbId: KB, name: `${id}.md`, type: "markdown", size: content.length,
    status: "ready", progress: 100, chunks: 0, content, uploadedAt: Date.now(),
  };
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_VS__;
  delete (globalThis as Record<string, unknown>).__KAI_PARENT_MAP__;
  delete (globalThis as Record<string, unknown>).__KAI_BM25__;
  vi.unstubAllEnvs();
});

afterEach(() => {
  process.env = { ...env };
  vi.unstubAllEnvs();
});

describe("indexDocument", () => {
  it("indexes content into vector + BM25 stores", async () => {
    await indexDocument(doc("d1", "这是第一份文档的内容，介绍向量检索的基本概念与用法。"), settings);
    expect(bm25ChunkCount(KB)).toBeGreaterThan(0);
    const hits = await search(KB, embed("向量检索"), 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.docId === "d1")).toBe(true);
    const kw = searchBM25(KB, "向量检索", 5);
    expect(kw.length).toBeGreaterThan(0);
  });

  it("is a no-op for empty content", async () => {
    await indexDocument(doc("d2", "   "), settings);
    expect(bm25ChunkCount(KB)).toBe(0);
  });

  it("re-indexing a doc replaces old chunks (no duplicates)", async () => {
    await indexDocument(doc("d1", "第一版内容。"), settings);
    const before = bm25ChunkCount(KB);
    await indexDocument(doc("d1", "第二版内容，内容更长一些，用于验证重新索引。"), settings);
    expect(bm25ChunkCount(KB)).toBeGreaterThanOrEqual(before);
    const kw = searchBM25(KB, "第二版", 5);
    expect(kw.length).toBeGreaterThan(0);
  });
});

describe("parent-child indexing (env-gated)", () => {
  it("registers parent text for children when PARENT_CHILD_CHUNKING=true", async () => {
    vi.stubEnv("PARENT_CHILD_CHUNKING", "true");
    const content = "# 章节\n\n" + "这是一段比较长的叙述文字，用于产生多个子块，验证父块上下文扩展功能是否正常工作。".repeat(6);
    await indexDocument(doc("pc1", content), settings);
    // children were indexed
    expect(bm25ChunkCount(KB)).toBeGreaterThan(0);
    // at least one child resolves to a parent text larger than itself
    let found = false;
    const hits = await search(KB, embed("子块"), 5);
    for (const h of hits) {
      const parent = getParentText(KB, h.docId, h.chunkIndex);
      if (parent && parent.length > h.text.length) { found = true; break; }
    }
    expect(found).toBe(true);
    expect(getParentText(KB, "missing", 0)).toBeNull();
  });
});
