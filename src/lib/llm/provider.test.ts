// P7-5 adapter tests: llm/provider via the Vercel AI SDK (`ai` + `@ai-sdk/openai`
// are mocked; the provider's own contract - resolution order, demo fallback,
// usage recording, graceful HTTP-error handling - is asserted).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateText, streamText, embed, embedMany } from "ai";
import { chatComplete, chatStream, embedText, embedBatch, isLLMEnabled } from "./provider";
import { resetMetrics, getMetricsSnapshot } from "@/lib/obs/metrics";
import type { ChatMessage } from "./types";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  embed: vi.fn(),
  embedMany: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    chat: (modelId: string) => ({ provider: "openai-mock", modelId }),
    embedding: (modelId: string) => ({ provider: "openai-mock-embed", modelId }),
  })),
}));

// Real SDK result types - mock payloads stay shape-checked instead of `as never`.
type MockTextResult = Awaited<ReturnType<typeof generateText>>;
type MockStreamResult = ReturnType<typeof streamText>;
type MockEmbedResult = Awaited<ReturnType<typeof embed>>;
type MockEmbedManyResult = Awaited<ReturnType<typeof embedMany>>;

function mockGenerateText(text: string, usage = { inputTokens: 10, outputTokens: 5 }) {
  vi.mocked(generateText).mockResolvedValue({ text, usage } as MockTextResult);
}

beforeEach(() => {
  resetMetrics();
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("OPENAI_BASE_URL", "https://llm.example.com/v1");
  vi.stubEnv("CHAT_MODEL", "gpt-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const msg = (m: Partial<ChatMessage> & Pick<ChatMessage, "content">): ChatMessage => ({
  role: m.role ?? "user",
  content: m.content,
  images: m.images,
});

describe("chatComplete (generateText)", () => {
  it("returns the generated text and records usage", async () => {
    mockGenerateText("回答内容[1]");
    const out = await chatComplete([msg({ content: "问题" })]);
    expect(out).toBe("回答内容[1]");
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.3,
        allowSystemInMessages: true,
        maxOutputTokens: undefined,
      })
    );
    const llm = getMetricsSnapshot().llm;
    expect(llm.calls).toBe(1);
    expect(llm.promptTokens).toBe(10);
    expect(llm.completionTokens).toBe(5);
  });

  it("passes system messages through (generator uses messages[0] as the prompt)", async () => {
    mockGenerateText("ok");
    await chatComplete([msg({ role: "system", content: "你是助手" }), msg({ content: "hi" })]);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "你是助手" },
          { role: "user", content: "hi" },
        ],
        allowSystemInMessages: true,
      })
    );
  });

  it("maps images to AI SDK image parts", async () => {
    mockGenerateText("看图回答");
    await chatComplete([msg({ content: "看这张图", images: [{ mime: "image/png", data: "aGVsbG8=" }] })]);
    const call = vi.mocked(generateText).mock.calls[0][0] as { messages: Array<{ content: unknown }> };
    expect(call.messages[0].content).toEqual([
      { type: "text", text: "看这张图" },
      { type: "image", image: "data:image/png;base64,aGVsbG8=" },
    ]);
  });

  it("returns '' on HTTP errors (graceful) and records the failure", async () => {
    vi.mocked(generateText).mockRejectedValue(
      Object.assign(new Error("upstream 429"), { statusCode: 429 })
    );
    const out = await chatComplete([msg({ content: "q" })]);
    expect(out).toBe("");
    expect(getMetricsSnapshot().llm.errors).toBe(1);
  });

  it("rethrows network errors (no statusCode)", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(chatComplete([msg({ content: "q" })])).rejects.toThrow("ECONNREFUSED");
  });

  it("demo mode (no provider configured) returns '' without calling the SDK", async () => {
    vi.unstubAllEnvs();
    expect(await isLLMEnabled()).toBe(false);
    expect(await chatComplete([msg({ content: "q" })])).toBe("");
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("chatStream (streamText)", () => {
  it("yields deltas from textStream and records usage", async () => {
    vi.mocked(streamText).mockReturnValue({
      textStream: (async function* () {
        yield "你";
        yield "好";
      })(),
      usage: Promise.resolve({ inputTokens: 3, outputTokens: 2 }),
    } as unknown as MockStreamResult);
    const deltas: string[] = [];
    for await (const d of chatStream([msg({ content: "q" })], { maxTokens: 800 })) {
      deltas.push(d);
    }
    expect(deltas).toEqual(["你", "好"]);
    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 800 }));
    const llm = getMetricsSnapshot().llm;
    expect(llm.calls).toBe(1);
    expect(llm.promptTokens).toBe(3);
  });

  it("yields nothing on HTTP errors (graceful)", async () => {
    vi.mocked(streamText).mockImplementation(() => {
      throw Object.assign(new Error("429"), { statusCode: 429 });
    });
    const deltas: string[] = [];
    for await (const d of chatStream([msg({ content: "q" })])) deltas.push(d);
    expect(deltas).toEqual([]);
  });

  it("demo mode yields nothing", async () => {
    vi.unstubAllEnvs();
    const deltas: string[] = [];
    for await (const d of chatStream([msg({ content: "q" })])) deltas.push(d);
    expect(deltas).toEqual([]);
    expect(streamText).not.toHaveBeenCalled();
  });
});

describe("embeddings (embed / embedMany)", () => {
  it("embedText returns a Float32Array from the SDK", async () => {
    vi.mocked(embed).mockResolvedValue({ embedding: [0.1, 0.2, 0.3] } as MockEmbedResult);
    const v = await embedText("hello");
    expect(v).toBeInstanceOf(Float32Array);
    // Float32Array rounds - compare with tolerance
    expect(v[0]).toBeCloseTo(0.1, 5);
    expect(v[1]).toBeCloseTo(0.2, 5);
    expect(v[2]).toBeCloseTo(0.3, 5);
    expect(embed).toHaveBeenCalledWith(expect.objectContaining({ value: "hello" }));
  });

  it("embedBatch returns Float32Array[] from the SDK", async () => {
    vi.mocked(embedMany).mockResolvedValue({ embeddings: [[0.1], [0.2], [0.3]] } as MockEmbedManyResult);
    const out = await embedBatch(["a", "b", "c"]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeInstanceOf(Float32Array);
  });

  it("falls back to local embeddings on SDK errors", async () => {
    vi.mocked(embed).mockRejectedValue(new Error("boom"));
    const v = await embedText("hello");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBeGreaterThan(0);
    expect(getMetricsSnapshot().llm.errors).toBe(1);
  });

  it("demo mode uses local embeddings without the SDK", async () => {
    vi.unstubAllEnvs();
    const v = await embedText("hello");
    expect(v).toBeInstanceOf(Float32Array);
    expect(embed).not.toHaveBeenCalled();
  });
});
