// Batch 2 (property-based): chunking must never lose content, no matter the
// input shape. Example-based tests cover the markdown/table paths; these
// properties cover the long tail of generated plain text.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { chunkText } from "./chunker";

const SEGMENTS = ["客服", "退款", "知识库", "检索", "向量", "BM25", "切片", "引用", "答案", "文档"];

/** Plain narrative text (no headings / tables / code fences). */
const plainText = (min = 1) =>
  fc
    .array(fc.constantFrom(...SEGMENTS), { minLength: min, maxLength: 120 })
    .map((parts) => parts.join(" "));

describe("chunkText properties", () => {
  it("returns [] for empty or whitespace-only input", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[ \t\n\r]*$/), (blank) => {
        expect(chunkText(blank, 200, 20)).toEqual([]);
      })
    );
  });

  it("never emits an empty chunk", () => {
    fc.assert(
      fc.property(plainText(), (text) => {
        for (const chunk of chunkText(text, 200, 20)) {
          expect(chunk.trim().length).toBeGreaterThan(0);
        }
      })
    );
  });

  it("keeps every character of the input somewhere in the output", () => {
    fc.assert(
      fc.property(plainText(), (text) => {
        const chunks = chunkText(text, 120, 10);
        const joined = chunks.join("");
        for (const ch of text.replace(/\s/g, "")) {
          expect(joined).toContain(ch);
        }
      })
    );
  });

  it("bounds chunk length: sparse text grows at most 1.3x, dense shrinks", () => {
    fc.assert(
      fc.property(plainText(), fc.integer({ min: 40, max: 400 }), (text, size) => {
        const chunks = chunkText(text, size, Math.floor(size / 10));
        for (const chunk of chunks) {
          expect(chunk.length).toBeLessThanOrEqual(Math.ceil(size * 1.3) + 1);
        }
      })
    );
  });

  it("is stable: chunking the same text twice yields the same chunks", () => {
    fc.assert(
      fc.property(plainText(), (text) => {
        expect(chunkText(text, 150, 15)).toEqual(chunkText(text, 150, 15));
      })
    );
  });
});
