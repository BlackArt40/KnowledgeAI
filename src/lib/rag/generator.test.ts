// P6-3 unit tests: rag/generator (extractive demo-mode answer composition).
import { describe, it, expect } from "vitest";
import { generate } from "./generator";
import type { RetrievedChunk } from "./types";

function chunk(docId: string, text: string, chunkIndex = 0): RetrievedChunk {
  return { docId, docName: `${docId}.md`, chunkIndex, text, score: 0.5 };
}

describe("generate (extractive fallback)", () => {
  it("returns a friendly empty answer for no chunks", () => {
    const out = generate("question", []);
    expect(out.text).toContain("未在当前知识库中检索到相关内容");
    expect(out.citations).toEqual([]);
  });

  it("composes an answer from relevant sentences with citations", () => {
    const chunks = [
      chunk("doc-1", "KnowledgeAI 支持向量检索。它结合 BM25 关键词与语义向量。"),
      chunk("doc-2", "知识库支持多格式文档上传。文档会被自动切片。"),
    ];
    const out = generate("向量检索", chunks);
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.citations.length).toBeGreaterThan(0);
    // citations reference real docs
    for (const c of out.citations) {
      expect(c.docId).toMatch(/^doc-/);
      expect(typeof c.snippet).toBe("string");
    }
  });

  it("falls back to a snippet citation when no sentence scores above threshold", () => {
    const chunks = [chunk("doc-1", "完全无关的内容在这里。" )];
    const out = generate("zzz 不存在的话题 12345", chunks);
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.citations.length).toBe(1);
    expect(out.citations[0].docId).toBe("doc-1");
  });
});
