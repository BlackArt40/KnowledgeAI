// P6-3 unit tests: rag/vector-store (public API over the memory backend).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { indexChunks, clearDoc, clearKb, search, chunkCount } from "./vector-store";
import { embed } from "./embeddings";

const env = process.env;
const KB = "vs-test-kb";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_VS__;
  delete (globalThis as Record<string, unknown>).__KAI_BM25__;
  vi.unstubAllEnvs();
});

afterEach(() => {
  process.env = { ...env };
  vi.unstubAllEnvs();
});

describe("vector-store public API", () => {
  it("indexChunks -> search finds the nearest chunks", async () => {
    await indexChunks(KB, "doc-a", "Doc A", ["向量数据库检索技术详解", "另一个完全不相关的句子"]);
    const hits = await search(KB, embed("向量检索"), 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].docId).toBe("doc-a");
    expect(await chunkCount(KB)).toBe(2);
  });

  it("clearDoc removes one doc from the vector store", async () => {
    await indexChunks(KB, "doc-a", "Doc A", ["苹果香蕉水果"]);
    await indexChunks(KB, "doc-b", "Doc B", ["樱桃甜点食谱"]);
    expect(await chunkCount(KB)).toBe(2);
    await clearDoc(KB, "doc-a");
    expect(await chunkCount(KB)).toBe(1);
    const hits = await search(KB, embed("苹果"), 5);
    expect(hits.every((h) => h.docId === "doc-b")).toBe(true);
  });

  it("clearKb removes everything", async () => {
    await indexChunks(KB, "doc-a", "Doc A", ["苹果香蕉水果"]);
    await clearKb(KB);
    expect(await chunkCount(KB)).toBe(0);
    expect(await search(KB, embed("苹果"), 5)).toEqual([]);
  });

  it("falls back to local embeddings when no LLM is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await indexChunks(KB, "doc-a", "Doc A", ["本地嵌入回退测试内容"]);
    expect(await chunkCount(KB)).toBe(1);
  });
});
