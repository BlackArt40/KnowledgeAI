// P0 (batch 1): extractive (demo-mode) streaming path — token chunking keeps
// [n] citation markers atomic, and the optional url/sourceType fields survive
// into citations returned by both sync and streaming generation.
import { describe, it, expect, beforeEach } from "vitest";
import { generate, generateStream } from "./generator";
import type { RetrievedChunk } from "./types";

function chunk(over: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    docId: "d1",
    docName: "a.md",
    chunkIndex: 0,
    text: "向量检索是核心技术。它结合 BM25 与语义向量。",
    score: 0.5,
    ...over,
  };
}

beforeEach(() => {
  // Demo mode: no provider configured -> extractive generation.
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
});

describe("generate (citation assembly)", () => {
  it("keeps url and sourceType on both citation and fallback paths", () => {
    const out = generate("向量检索", [
      chunk({ url: "https://kb.example/a", sourceType: "web" }),
    ]);
    expect(out.citations[0]).toMatchObject({ url: "https://kb.example/a", sourceType: "web" });
  });

  it("reuses one citation number for sentences from the same chunk", () => {
    const out = generate("向量检索", [
      chunk({ text: "向量检索是核心技术。向量检索结合关键词与语义。它提升召回率。" }),
    ]);
    const markers = out.text.match(/\[(\d+)\]/g) ?? [];
    expect(markers.length).toBeGreaterThan(1);
    expect(new Set(markers)).toEqual(new Set(["[1]"]));
    expect(out.citations).toHaveLength(1);
  });

  it("numbers citations in chunk order after re-ranking", () => {
    const out = generate("文档上传", [
      chunk({ docId: "d1", chunkIndex: 0, text: "文档上传支持多种格式。", score: 0.9 }),
      chunk({ docId: "d2", chunkIndex: 0, text: "文档上传后自动切片并入库。", score: 0.8 }),
    ]);
    expect(out.citations.map((c) => c.n)).toEqual([1, 2]);
    expect(out.citations.map((c) => c.docId)).toEqual(["d1", "d2"]);
  });
});

describe("generateStream (extractive path)", () => {
  async function drain(gen: AsyncGenerator<{ type: string; text?: string }, { text: string }>) {
    const tokens: string[] = [];
    let result: { text: string } | undefined;
    for (;;) {
      const next = await gen.next();
      if (next.done) {
        result = next.value;
        break;
      }
      if (next.value.type === "token" && next.value.text) tokens.push(next.value.text);
    }
    return { tokens, result };
  }

  it("streams the extractive answer and keeps citation markers atomic", async () => {
    const { tokens, result } = await drain(
      generateStream("向量检索", [chunk()]) as unknown as AsyncGenerator<{ type: string; text?: string }, { text: string }>
    );

    expect(tokens.join("")).toBe(result!.text);
    // A marker never gets split across two tokens.
    const markers = tokens.filter((t) => /^\[\d+\]$/.test(t));
    expect(markers.length).toBeGreaterThan(0);
    expect(tokens.some((t) => t.includes("[") && !/^\[\d+\]$/.test(t))).toBe(false);
  });

  it("streams the friendly message when there are no chunks", async () => {
    const { tokens, result } = await drain(
      generateStream("q", []) as unknown as AsyncGenerator<{ type: string; text?: string }, { text: string }>
    );
    expect(tokens.join("")).toContain("未在当前知识库中检索到相关内容");
    expect(result!.text).toBe(tokens.join(""));
  });
});
