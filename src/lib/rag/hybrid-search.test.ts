// P6-3 unit tests: rag/hybrid-search (vector + BM25 RRF fusion, in-memory).
import { describe, it, expect, beforeAll } from "vitest";
import { hybridSearch } from "./hybrid-search";
import { indexDocument } from "./indexer";
import { clearBM25Kb } from "./bm25";
import { embed } from "@/lib/llm/embeddings";
import type { KbDocument, KbSettings } from "@/lib/kb/types";

const KB = "hybrid-test-kb";
const settings: KbSettings = { chunkSize: 300, chunkOverlap: 20, embeddingModel: "local", topK: 5 };

function doc(id: string, content: string): KbDocument {
  return {
    id, kbId: KB, name: `${id}.md`, type: "markdown", size: content.length,
    status: "ready", progress: 100, chunks: 0, content, uploadedAt: Date.now(),
  };
}

beforeAll(async () => {
  clearBM25Kb(KB);
  await indexDocument(doc("d1", "# 混合检索\n\n向量检索与 BM25 关键词检索通过 RRF 融合排序，效果优于单一方法。"), settings);
  await indexDocument(doc("d2", "# 做饭\n\n今晚做西红柿炒鸡蛋，需要准备鸡蛋与番茄。"), settings);
});

describe("hybridSearch", () => {
  it("fuses vector + BM25 results for the matching doc", async () => {
    const out = await hybridSearch(KB, "混合检索", embed("混合检索"), { topK: 3 });
    expect(out.length).toBeGreaterThan(0);
    const ids = new Set(out.map((r) => r.docId));
    expect(ids.has("d1")).toBe(true);
  });

  it("ranks the keyword-relevant doc for its own terms", async () => {
    const out = await hybridSearch(KB, "西红柿炒鸡蛋", embed("西红柿炒鸡蛋"), { topK: 3 });
    const ids = new Set(out.map((r) => r.docId));
    expect(ids.has("d2")).toBe(true);
  });

  it("respects docIdFilter (all results belong to the filter set)", async () => {
    const out = await hybridSearch(KB, "混合检索", embed("混合检索"), { topK: 5, docIdFilter: ["d1"] });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.docId === "d1")).toBe(true);
    // filter to the unrelated doc: nearest-neighbor store still returns it (score 0)
    const other = await hybridSearch(KB, "混合检索", embed("混合检索"), { topK: 5, docIdFilter: ["d2"] });
    expect(other.every((r) => r.docId === "d2")).toBe(true);
  });

  it("returns [] for an unknown KB", async () => {
    const out = await hybridSearch("missing-kb", "q", embed("q"), { topK: 3 });
    expect(out).toEqual([]);
  });
});
