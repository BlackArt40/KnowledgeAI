// Batch 2 (property-based): tokenisation and index invariants. Re-indexing the
// same document must never accumulate duplicates, and a query built from an
// indexed token must always find its own chunk first.
import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { bm25ChunkCount, clearBM25Kb, indexBM25, searchBM25, tokenize } from "./bm25";

const KB = "property-kb";

beforeEach(() => {
  clearBM25Kb(KB);
});

const WORDS = ["vector", "search", "refund", "invoice", "chunk", "bm25", "citation"];

describe("tokenize properties", () => {
  it("never returns empty or whitespace-bearing tokens", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        for (const token of tokenize(input)) {
          expect(token.length).toBeGreaterThan(0);
          expect(token).not.toMatch(/\s/);
        }
      })
    );
  });

  it("lowercases every token", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        for (const token of tokenize(input)) {
          expect(token).toBe(token.toLowerCase());
        }
      })
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(tokenize(input)).toEqual(tokenize(input));
      })
    );
  });
});

describe("index invariants", () => {
  it("re-indexing the same document replaces its chunks instead of duplicating", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 8 }),
        (words) => {
          clearBM25Kb(KB);
          indexBM25(KB, "doc-1", "a.md", words.map((w) => `${w} text`));
          const first = bm25ChunkCount(KB);
          indexBM25(KB, "doc-1", "a.md", words.map((w) => `${w} text`));
          expect(bm25ChunkCount(KB)).toBe(first);
        }
      )
    );
  });

  it("finds the chunk that contains the query token, with a positive score", () => {
    fc.assert(
      fc.property(fc.constantFrom(...WORDS), (word) => {
        clearBM25Kb(KB);
        indexBM25(KB, "doc-hit", "hit.md", [`${word} appears in this chunk`]);
        indexBM25(KB, "doc-other", "other.md", ["completely unrelated content"]);

        const hits = searchBM25(KB, word, 5);

        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0]).toMatchObject({ docId: "doc-hit", chunkIndex: 0 });
        expect(hits[0].score).toBeGreaterThan(0);
      })
    );
  });

  it("returns [] for a token that is indexed nowhere", () => {
    fc.assert(
      fc.property(fc.uuid(), (uuid) => {
        clearBM25Kb(KB);
        indexBM25(KB, "doc-1", "a.md", ["vector search"]);
        expect(searchBM25(KB, uuid, 5)).toEqual([]);
      })
    );
  });

  it("respects topK", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (k) => {
        clearBM25Kb(KB);
        indexBM25(KB, "doc-1", "a.md", ["vector one", "vector two", "vector three", "vector four"]);
        expect(searchBM25(KB, "vector", k).length).toBeLessThanOrEqual(k);
      })
    );
  });
});
