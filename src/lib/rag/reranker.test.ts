// P6-3 unit tests: rag/reranker (pure parse + no-LLM fallback path).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { parseIndexList, rerank, __test } from "./reranker";
import { chatComplete, isLLMEnabled } from "@/lib/llm/provider";
import type { RetrievedChunk } from "./types";

vi.mock("@/lib/llm/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/provider")>();
  return {
    ...actual,
    isLLMEnabled: vi.fn(async () => false),
    chatComplete: vi.fn(async () => "2,1,3"),
  };
});

const env = process.env;

afterEach(() => {
  process.env = { ...env };
  vi.unstubAllEnvs();
  vi.mocked(isLLMEnabled).mockResolvedValue(false);
});

beforeEach(() => {
  vi.mocked(chatComplete).mockResolvedValue("2,1,3");
});

function chunk(i: number): RetrievedChunk {
  return {
    docId: `doc-${i}`,
    docName: `Doc ${i}`,
    chunkIndex: 0,
    text: `chunk number ${i} content`,
    score: 1 / (i + 1),
  };
}

describe("parseIndexList", () => {
  it("parses [1,3,2] style output and clamps to maxIndex", () => {
    expect(parseIndexList("[1, 3, 2]", 3)).toEqual([1, 3, 2]);
    expect(parseIndexList("2,4,1", 2)).toEqual([2, 1]); // 4 out of range
  });

  it("dedupes and ignores garbage", () => {
    expect(parseIndexList("[0, 0, abc, 1]", 5)).toEqual([0, 1]);
    expect(parseIndexList("", 5)).toEqual([]);
    expect(parseIndexList("   ", 5)).toEqual([]);
  });
});

describe("__test env gates", () => {
  it("rerankEnabled defaults true, respects env=false", () => {
    expect(__test.rerankEnabled()).toBe(true);
    vi.stubEnv("RERANK_ENABLED", "false");
    expect(__test.rerankEnabled()).toBe(false);
  });

  it("rerankCandidates parses positive ints with default 20", () => {
    expect(__test.rerankCandidates()).toBe(20);
    vi.stubEnv("RERANK_CANDIDATES", "8");
    expect(__test.rerankCandidates()).toBe(8);
    vi.stubEnv("RERANK_CANDIDATES", "abc");
    expect(__test.rerankCandidates()).toBe(20);
  });
});

describe("rerank without LLM (demo fallback)", () => {
  it("returns candidates in original order when LLM is off", async () => {
    vi.stubEnv("RERANK_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "");
    const cands = [chunk(1), chunk(2), chunk(3)];
    const out = await rerank("some query", cands, 2);
    expect(out).toHaveLength(2);
    expect(out[0].docId).toBe("doc-1");
  });

  it("returns everything when topK >= candidates", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const cands = [chunk(1), chunk(2)];
    const out = await rerank("q", cands, 10);
    expect(out).toHaveLength(2);
  });
});

describe("rerank with LLM (mocked)", () => {
  it("reorders candidates by the LLM index list", async () => {
    vi.mocked(isLLMEnabled).mockResolvedValue(true);
    vi.mocked(chatComplete).mockResolvedValueOnce("1,0,2");
    const cands = [chunk(1), chunk(2), chunk(3)];
    const out = await rerank("q", cands, 3);
    expect(out.map((c) => c.docId)).toEqual(["doc-2", "doc-1", "doc-3"]);
  });

  it("keeps original order when the LLM call fails", async () => {
    vi.mocked(isLLMEnabled).mockResolvedValue(true);
    vi.mocked(chatComplete).mockRejectedValue(new Error("llm down"));
    const cands = [chunk(1), chunk(2), chunk(3)];
    const out = await rerank("q", cands, 3);
    expect(out.map((c) => c.docId)).toEqual(["doc-1", "doc-2", "doc-3"]);
  });

  it("keeps original order when the LLM returns an empty index list", async () => {
    vi.mocked(isLLMEnabled).mockResolvedValue(true);
    vi.mocked(chatComplete).mockResolvedValue("no indices here");
    const cands = [chunk(1), chunk(2)];
    const out = await rerank("q", cands, 2);
    expect(out.map((c) => c.docId)).toEqual(["doc-1", "doc-2"]);
  });
});
