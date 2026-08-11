// P6-3 unit tests: rag/bm25 (in-memory keyword index on globalThis).
import { describe, it, expect, beforeEach } from "vitest";
import { indexBM25, clearBM25Doc, clearBM25Kb, searchBM25, bm25ChunkCount } from "./bm25";

const KB = "bm25-test-kb";

beforeEach(() => {
  clearBM25Kb(KB);
});

describe("bm25 index management", () => {
  it("indexes chunks and counts them", () => {
    indexBM25(KB, "doc-1", "Doc One", ["apple banana fruit", "apple pie recipe"]);
    expect(bm25ChunkCount(KB)).toBe(2);
  });

  it("re-indexing a doc replaces its old chunks", () => {
    indexBM25(KB, "doc-1", "Doc One", ["apple banana", "cherry"]);
    indexBM25(KB, "doc-1", "Doc One", ["only one chunk now"]);
    expect(bm25ChunkCount(KB)).toBe(1);
  });

  it("clearBM25Doc removes one doc, keeps others", () => {
    indexBM25(KB, "doc-1", "Doc One", ["apple banana"]);
    indexBM25(KB, "doc-2", "Doc Two", ["cherry date"]);
    clearBM25Doc(KB, "doc-1");
    expect(bm25ChunkCount(KB)).toBe(1);
  });

  it("clearBM25Kb removes the whole index", () => {
    indexBM25(KB, "doc-1", "Doc One", ["apple banana"]);
    clearBM25Kb(KB);
    expect(bm25ChunkCount(KB)).toBe(0);
    expect(searchBM25(KB, "apple", 5)).toEqual([]);
  });
});

describe("bm25 search", () => {
  it("ranks exact keyword matches above unrelated docs", () => {
    indexBM25(KB, "doc-1", "Doc One", ["knowledge base document management system"]);
    indexBM25(KB, "doc-2", "Doc Two", ["cooking recipes for dinner tonight"]);
    const results = searchBM25(KB, "knowledge base", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe("doc-1");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("supports CJK unigram + bigram matching", () => {
    indexBM25(KB, "doc-1", "Doc One", ["向量数据库检索技术研究"]);
    const results = searchBM25(KB, "向量数据库", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].docId).toBe("doc-1");
  });

  it("respects topK and returns chunks sorted by score", () => {
    indexBM25(KB, "doc-1", "Doc One", ["apple apple apple apple", "apple banana"]);
    indexBM25(KB, "doc-2", "Doc Two", ["apple cherry"]);
    const results = searchBM25(KB, "apple", 1);
    expect(results.length).toBe(1);
    const scores = results.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("returns [] for empty index, empty query, or no match", () => {
    expect(searchBM25(KB, "anything", 5)).toEqual([]);
    indexBM25(KB, "doc-1", "Doc One", ["apple banana"]);
    expect(searchBM25(KB, "", 5)).toEqual([]);
    expect(searchBM25(KB, "zzzqqq", 5)).toEqual([]);
  });

  it("search results carry docId/docName/chunkIndex/text", () => {
    indexBM25(KB, "doc-9", "Doc Nine", ["unique token xyz"]);
    const r = searchBM25(KB, "unique token", 5);
    expect(r[0]).toMatchObject({ docId: "doc-9", docName: "Doc Nine", chunkIndex: 0 });
    expect(typeof r[0].text).toBe("string");
  });
});
