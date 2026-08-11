// P6-3 unit tests: rag/query-rewrite (pure parse + env-gated fallback paths).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { parseQueryLines, rewriteQuery } from "./query-rewrite";
import { chatComplete, isLLMEnabled } from "@/lib/llm/provider";

vi.mock("@/lib/llm/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/provider")>();
  return {
    ...actual,
    isLLMEnabled: vi.fn(async () => false),
    chatComplete: vi.fn(async () => "改写一\n改写二\n改写三"),
  };
});

const env = process.env;

afterEach(() => {
  process.env = { ...env };
  vi.unstubAllEnvs();
  vi.mocked(isLLMEnabled).mockResolvedValue(false);
});

beforeEach(() => {
  vi.mocked(chatComplete).mockResolvedValue("改写一\n改写二\n改写三");
});

describe("parseQueryLines", () => {
  it("parses numbered / plain / empty lines and caps at maxCount", () => {
    const out = parseQueryLines("1. 检索优化方案\n2. 如何提升检索精度\n3. 混合检索怎么做\n", 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("检索优化方案");
  });

  it("filters duplicates and empty lines", () => {
    const out = parseQueryLines("\n重复问题\n重复问题\n\n", 10);
    expect(out).toEqual(["重复问题"]);
  });

  it("returns [] for empty input", () => {
    expect(parseQueryLines("", 3)).toEqual([]);
    expect(parseQueryLines(undefined as unknown as string, 3)).toEqual([]);
  });
});

describe("rewriteQuery fallback paths (no LLM / disabled)", () => {
  it("returns [query] when rewrite is disabled", async () => {
    vi.stubEnv("QUERY_REWRITE_ENABLED", "false");
    await expect(rewriteQuery("什么是 RAG")).resolves.toEqual(["什么是 RAG"]);
  });

  it("returns [query] when LLM is unavailable (demo mode)", async () => {
    vi.stubEnv("QUERY_REWRITE_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(rewriteQuery("什么是 RAG")).resolves.toEqual(["什么是 RAG"]);
  });
});

describe("rewriteQuery with LLM (mocked)", () => {
  it("prepends the original query and parses rewrites", async () => {
    vi.stubEnv("QUERY_REWRITE_ENABLED", "true");
    vi.mocked(isLLMEnabled).mockResolvedValue(true);
    const out = await rewriteQuery("检索优化");
    expect(out[0]).toBe("检索优化");
    expect(out).toContain("改写一");
    expect(out.length).toBe(4); // original + 3
  });

  it("falls back to [query] when the LLM call throws", async () => {
    vi.stubEnv("QUERY_REWRITE_ENABLED", "true");
    vi.mocked(isLLMEnabled).mockResolvedValue(true);
    vi.mocked(chatComplete).mockRejectedValue(new Error("llm down"));
    await expect(rewriteQuery("检索优化")).resolves.toEqual(["检索优化"]);
  });
});
