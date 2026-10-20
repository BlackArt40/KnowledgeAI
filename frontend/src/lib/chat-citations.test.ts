import { describe, expect, it } from "vitest";
import { extractLiveCitations } from "./chat-citations";

const sources = [
  { docId: "d1", docName: "Doc 1", chunkIndex: 0, snippet: "a", score: 0.9 },
  { docId: "d2", docName: "Doc 2", chunkIndex: 3, snippet: "b", score: 0.8, url: "https://x.dev" },
];

describe("extractLiveCitations", () => {
  it("returns citations in first-appearance order and dedupes", () => {
    const out = extractLiveCitations("see [2] and [1], again [2]", sources);
    expect(out.map((c) => c.n)).toEqual([2, 1]);
    expect(out[0]).toMatchObject({ docId: "d2", url: "https://x.dev" });
  });

  it("ignores out-of-range and non-numeric markers", () => {
    const out = extractLiveCitations("bad [0] [3] [x]", sources);
    expect(out).toEqual([]);
  });

  it("returns empty when there are no sources", () => {
    expect(extractLiveCitations("[1]", [])).toEqual([]);
  });
});
