// P0 (batch 1): hybrid-search branches the in-memory integration test cannot
// reach — createdAfter filtering (via the KB store), the vector-empty /
// BM25-empty shortcuts, and the docFilter ∩ createdAfter intersection.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetrievedChunk } from "./types";

const vector: RetrievedChunk[] = [];
const bm25: RetrievedChunk[] = [];

vi.mock("./vector-store", () => ({
  search: vi.fn(async () => vector),
}));
vi.mock("./bm25", () => ({
  searchBM25: vi.fn(() => bm25),
}));
vi.mock("@/lib/kb/store", () => ({
  listDocuments: vi.fn(() => []),
}));

import { hybridSearch } from "./hybrid-search";
import { listDocuments } from "@/lib/kb/store";

function chunk(docId: string, chunkIndex = 0, score = 0.5): RetrievedChunk {
  return { docId, docName: `${docId}.md`, chunkIndex, text: `${docId} text`, score };
}

function reset() {
  vector.length = 0;
  bm25.length = 0;
  vi.mocked(listDocuments).mockReturnValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  reset();
});

describe("hybridSearch shortcuts", () => {
  it("returns vector results when the BM25 index is empty", async () => {
    vector.push(chunk("v1"), chunk("v2"));

    const out = await hybridSearch("kb", "q", new Float32Array([1]), { topK: 1 });

    expect(out).toHaveLength(1);
    expect(out[0].docId).toBe("v1");
  });

  it("returns BM25 results when the vector store is empty", async () => {
    bm25.push(chunk("b1", 0, 2.5), chunk("b2", 0, 1.5));

    const out = await hybridSearch("kb", "q", new Float32Array([1]), { topK: 1 });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ docId: "b1", score: 2.5 });
  });

  it("keeps BM25-only hits without the url/sourceType fields", async () => {
    bm25.push(chunk("b1"));

    const [hit] = await hybridSearch("kb", "q", new Float32Array([1]), { topK: 5 });

    expect(hit).not.toHaveProperty("url");
    expect(hit).not.toHaveProperty("sourceType");
  });
});

describe("createdAfter filtering", () => {
  it("restricts results to documents uploaded after the timestamp", async () => {
    vector.push(chunk("old"), chunk("new"));
    bm25.push(chunk("old"), chunk("new"));
    vi.mocked(listDocuments).mockReturnValue([
      { id: "old", uploadedAt: 1_000 },
      { id: "new", uploadedAt: 9_000 },
    ] as unknown as ReturnType<typeof listDocuments>);

    const out = await hybridSearch("kb", "q", new Float32Array([1]), { topK: 5, createdAfter: 5_000 });

    expect(out.map((c) => c.docId)).toEqual(["new"]);
  });

  it("intersects createdAfter with an explicit docIdFilter", async () => {
    vector.push(chunk("a"), chunk("b"));
    bm25.push(chunk("a"), chunk("b"));
    vi.mocked(listDocuments).mockReturnValue([
      { id: "a", uploadedAt: 1_000 },
      { id: "b", uploadedAt: 9_000 },
    ] as unknown as ReturnType<typeof listDocuments>);

    const out = await hybridSearch("kb", "q", new Float32Array([1]), {
      topK: 5,
      docIdFilter: ["a", "b"],
      createdAfter: 5_000,
    });

    expect(out.map((c) => c.docId)).toEqual(["b"]);
  });

  it("ignores the filter when the KB store is unavailable", async () => {
    vector.push(chunk("a"));
    bm25.push(chunk("a"));
    vi.mocked(listDocuments).mockImplementation(() => {
      throw new Error("store not ready");
    });

    const out = await hybridSearch("kb", "q", new Float32Array([1]), { topK: 5, createdAfter: 5_000 });

    expect(out.map((c) => c.docId)).toEqual(["a"]);
  });
});
