// P0 (batch 1): retriever orchestration beyond the happy path — multi-query
// RRF fusion, candidate pool sizing, parent-context expansion (with
// deduplication) and the failure path that marks the RAG metric as failed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RetrievedChunk } from "./types";

const fixture: Record<string, RetrievedChunk[]> = {};

vi.mock("@/lib/llm/provider", () => ({
  embedText: vi.fn(async (t: string) => new Float32Array([t.length, 1])),
}));
vi.mock("./query-rewrite", () => ({
  rewriteQuery: vi.fn(async (q: string) => (q === "multi" ? ["q1", "q2"] : [q])),
}));
vi.mock("./reranker", () => ({
  rerank: vi.fn(async (_q: string, cands: RetrievedChunk[], topK: number) => cands.slice(0, topK)),
}));
vi.mock("./hybrid-search", () => ({
  hybridSearch: vi.fn(async (_kb: string, q: string) => fixture[q] ?? []),
}));
vi.mock("./indexer", () => ({
  getParentText: vi.fn(() => null),
}));
vi.mock("@/lib/obs/metrics", () => ({
  recordRag: vi.fn(),
}));

import { retrieve } from "./retriever";
import { hybridSearch } from "./hybrid-search";
import { getParentText } from "./indexer";
import { recordRag } from "@/lib/obs/metrics";

function chunk(docId: string, chunkIndex = 0): RetrievedChunk {
  return { docId, docName: `${docId}.md`, chunkIndex, text: `${docId}#${chunkIndex}`, score: 0.1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(fixture)) delete fixture[k];
  delete process.env.RERANK_CANDIDATES;
});

afterEach(() => {
  delete process.env.RERANK_CANDIDATES;
});

describe("multi-query fusion", () => {
  it("fuses results from every rewritten query via RRF and deduplicates chunks", async () => {
    fixture.q1 = [chunk("a"), chunk("b")];
    fixture.q2 = [chunk("a"), chunk("c")];

    const out = await retrieve("kb", "multi", 3);

    // "a" appears at rank 0 in both lists -> highest fused score, and only once.
    expect(out.map((c) => c.docId)).toEqual(["a", "b", "c"]);
    expect(out.filter((c) => c.docId === "a")).toHaveLength(1);
    expect(out[0].score).toBeCloseTo(2 / 61, 5);
  });

  it("asks hybrid search for the larger of the candidate pool and topK", async () => {
    fixture.single = [chunk("a")];
    process.env.RERANK_CANDIDATES = "7";

    await retrieve("kb", "single", 2);

    expect(hybridSearch).toHaveBeenCalledWith("kb", "single", expect.any(Float32Array), { topK: 7 });
  });

  it("falls back to 20 candidates for an invalid RERANK_CANDIDATES value", async () => {
    fixture.single = [chunk("a")];
    process.env.RERANK_CANDIDATES = "nope";

    await retrieve("kb", "single", 2);

    expect(hybridSearch).toHaveBeenCalledWith("kb", "single", expect.any(Float32Array), { topK: 20 });
  });
});

describe("parent-context expansion", () => {
  it("replaces child text with parent text and keeps chunks without a parent", async () => {
    fixture.single = [chunk("a", 0), chunk("b", 0)];
    vi.mocked(getParentText).mockImplementation((_kb, docId) =>
      docId === "a" ? "父级上下文全文" : null
    );

    const out = await retrieve("kb", "single", 2);

    expect(out.find((c) => c.docId === "a")?.text).toBe("父级上下文全文");
    expect(out.find((c) => c.docId === "b")?.text).toBe("b#0");
  });

  it("emits a duplicated chunk only once", async () => {
    fixture.single = [chunk("a", 0), chunk("a", 0)];
    vi.mocked(getParentText).mockReturnValue("父级上下文全文");

    const out = await retrieve("kb", "single", 2);

    expect(out).toHaveLength(1);
  });
});

describe("failure handling", () => {
  it("rethrows and records the RAG call as failed", async () => {
    fixture.single = [chunk("a")];
    vi.mocked(hybridSearch).mockRejectedValueOnce(new Error("vector store down"));

    await expect(retrieve("kb", "single", 2)).rejects.toThrow("vector store down");
    expect(recordRag).toHaveBeenCalledWith(expect.any(Number), true);
  });

  it("records a successful call", async () => {
    fixture.single = [chunk("a")];

    await retrieve("kb", "single", 2);

    expect(recordRag).toHaveBeenCalledWith(expect.any(Number), false);
  });
});
