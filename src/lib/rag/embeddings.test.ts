// P6-3 unit tests: rag/embeddings (pure deterministic hashed embeddings).
import { describe, it, expect } from "vitest";
import { embed, cosine, DIM } from "./embeddings";

describe("embeddings", () => {
  it("produces DIM-dimensional unit vectors", () => {
    const v = embed("hello world");
    expect(v.length).toBe(DIM);
    let sum = 0;
    for (let i = 0; i < DIM; i++) sum += v[i] * v[i];
    expect(Math.sqrt(sum)).toBeCloseTo(1, 5);
  });

  it("is deterministic", () => {
    expect(Array.from(embed("知识管理"))).toEqual(Array.from(embed("知识管理")));
  });

  it("similar text scores higher than dissimilar text", () => {
    const a = embed("向量数据库检索技术");
    const b = embed("向量数据库检索技术研究");
    const c = embed("今天天气很好适合出去散步");
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });

  it("CJK bigrams give partial overlap for shared chars", () => {
    const a = embed("知识库");
    const b = embed("知识图谱");
    const c = embed("completely different english");
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });

  it("empty text yields zero vector (no crash, cosine 0)", () => {
    const v = embed("");
    let norm = 0;
    for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
    // empty -> no tokens -> all zeros -> len 0 -> normalized to 0/1 = 0
    expect(norm).toBe(0);
  });

  it("identical vectors have cosine 1", () => {
    const a = embed("same phrase here");
    expect(cosine(a, a)).toBeCloseTo(1, 5);
  });
});
