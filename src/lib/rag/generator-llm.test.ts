// P6-3 unit tests: rag/generator LLM paths (mocked llm/provider).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateAsync, generateStream } from "./generator";
import { chatComplete, isLLMEnabled } from "@/lib/llm/provider";
import type { RetrievedChunk } from "./types";

vi.mock("@/lib/llm/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/provider")>();
  return {
    ...actual,
    isLLMEnabled: vi.fn(async () => true),
    chatComplete: vi.fn(async () => "这是基于来源的回答内容[1]。"),
    chatStream: vi.fn(async function* () {
      yield "这是";
      yield "流式回答[1]";
    }),
  };
});

function chunk(docId: string, text: string, chunkIndex = 0): RetrievedChunk {
  return { docId, docName: `${docId}.md`, chunkIndex, text, score: 0.5 };
}

beforeEach(() => {
  vi.mocked(isLLMEnabled).mockResolvedValue(true);
  vi.mocked(chatComplete).mockClear();
  vi.mocked(chatComplete).mockResolvedValue("这是基于来源的回答内容[1]。");
});

describe("generateAsync with LLM", () => {
  it("returns the LLM text with parsed [n] citations", async () => {
    const out = await generateAsync("问题", [chunk("d1", "来源一内容"), chunk("d2", "来源二内容")]);
    expect(out.text).toContain("回答内容");
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0].docId).toBe("d1");
    expect(out.citations[0].n).toBe(1);
  });

  it("passes history through the contextual prompt", async () => {
    const history = [{ role: "user" as const, content: "之前的问题" }];
    await generateAsync("新问题", [chunk("d1", "来源")], history);
    const messages = vi.mocked(chatComplete).mock.calls[0][0];
    const system = messages[0].content;
    expect(system).toContain("【对话历史】");
    expect(messages[1].content).toBe("新问题");
  });

  it("falls back to extractive when the LLM returns empty text", async () => {
    vi.mocked(chatComplete).mockResolvedValue("");
    const out = await generateAsync("向量检索", [chunk("d1", "向量检索是关键技术。")]);
    expect(out.text.length).toBeGreaterThan(0);
  });

  it("returns the friendly empty answer for no chunks", async () => {
    const out = await generateAsync("q", []);
    expect(out.text).toContain("未在当前知识库中检索到相关内容");
  });
});

describe("generateStream with LLM", () => {
  it("yields token events and returns citations", async () => {
    const events: string[] = [];
    let result;
    const gen = generateStream("q", [chunk("d1", "来源一内容")]);
    for await (const ev of gen) {
      if (ev.type === "token") events.push(ev.text ?? "");
      else result = ev;
    }
    expect(events.join("")).toBe("这是流式回答[1]");
    expect(result).toBeUndefined();
  });

  it("yields the friendly message for no chunks", async () => {
    const events: string[] = [];
    const gen = generateStream("q", []);
    let result;
    while (true) {
      const { done, value } = await gen.next();
      if (done) { result = value; break; }
      if (value.type === "token") events.push(value.text ?? "");
    }
    expect(events.join("")).toContain("未在当前知识库中检索到相关内容");
    expect(result).toEqual({ text: events.join(""), citations: [] });
  });
});
