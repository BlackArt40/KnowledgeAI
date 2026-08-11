// P6-3 unit tests: rag/conversation-context (intent + history + follow-ups).
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  classifyIntent,
  buildHistoryMessages,
  buildContextualSystemPrompt,
  suggestFollowUps,
} from "./conversation-context";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
  vi.unstubAllEnvs();
});

describe("classifyIntent", () => {
  it("detects chitchat greetings / thanks / goodbyes", () => {
    expect(classifyIntent("你好")).toBe("chitchat");
    expect(classifyIntent("Hello!")).toBe("chitchat");
    expect(classifyIntent("谢谢")).toBe("chitchat");
    expect(classifyIntent("再见")).toBe("chitchat");
    expect(classifyIntent("你是谁")).toBe("chitchat");
  });

  it("detects meta questions about the KB", () => {
    expect(classifyIntent("知识库里有哪些文档")).toBe("meta");
    expect(classifyIntent("list documents in the kb")).toBe("meta");
    expect(classifyIntent("知识库概况如何")).toBe("meta");
  });

  it("falls back to knowledge for real questions", () => {
    expect(classifyIntent("RAG 检索的 topK 怎么调")).toBe("knowledge");
    expect(classifyIntent("")).toBe("knowledge");
  });
});

describe("buildHistoryMessages", () => {
  it("caps history at the last 6 messages and truncates content", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "m" + i + "x".repeat(600),
    }));
    const out = buildHistoryMessages(history);
    expect(out).toHaveLength(6);
    expect(out[0].content.length).toBeLessThanOrEqual(500);
  });

  it("returns [] for empty history", () => {
    expect(buildHistoryMessages([])).toEqual([]);
  });
});

describe("buildContextualSystemPrompt", () => {
  it("includes base prompt, sources and the query", () => {
    const out = buildContextualSystemPrompt("什么是向量检索", [], "来源A\n来源B");
    expect(out[0].role).toBe("system");
    expect(out[0].content).toContain("【来源】");
    expect(out[0].content).toContain("来源A");
    expect(out[1]).toEqual({ role: "user", content: "什么是向量检索" });
  });

  it("adds chitchat instruction for chitchat intents", () => {
    const out = buildContextualSystemPrompt("你好", [], "");
    expect(out[0].content).toContain("闲聊问题");
  });

  it("adds history block when history exists", () => {
    const out = buildContextualSystemPrompt("q", [{ role: "user", content: "之前的问题" }], "");
    expect(out[0].content).toContain("【对话历史】");
  });
});

describe("suggestFollowUps (no LLM -> template)", () => {
  it("returns template suggestions keyed on query terms", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const out = await suggestFollowUps("什么是向量数据库", "答案内容", [{ docName: "报告.pdf" }]);
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.some((s) => s.includes("向量数据库"))).toBe(true);
  });

  it("falls back to generic suggestions for short queries", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const out = await suggestFollowUps("hi", "答案", []);
    expect(out.length).toBeGreaterThan(0);
  });
});
