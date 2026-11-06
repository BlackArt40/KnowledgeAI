// Batch 2 (P1): conversation store — title derivation, feedback bookkeeping,
// regenerate semantics and the retention/account-deletion counters. These are
// the states the chat SSE path and the admin views read back.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addMessage,
  createConversation,
  deleteAllConversations,
  deleteConversation,
  deleteConversationsOlderThan,
  getConversation,
  listAllConversations,
  listConversations,
  listFeedbackMessages,
  listSharedConversations,
  popLastAssistantMessage,
  setConversationArchived,
  setConversationShared,
  setConversationTags,
  setMessageFeedback,
} from "./store";

const g = globalThis as unknown as { __KAI_CHAT_STORE__?: unknown };

beforeEach(() => {
  delete g.__KAI_CHAT_STORE__;
});

describe("createConversation / addMessage", () => {
  it("creates an empty conversation scoped to the caller", () => {
    const conv = createConversation("kb_1", "新会话", "usr_1", "ws_1");

    expect(conv.kbId).toBe("kb_1");
    expect(conv.userId).toBe("usr_1");
    expect(conv.workspaceId).toBe("ws_1");
    expect(conv.messages).toEqual([]);
    expect(getConversation(conv.id)).toBe(conv);
  });

  it("derives the title from the first user message and truncates long text", () => {
    const conv = createConversation("kb_1", "新会话", "usr_1");

    addMessage(conv.id, { role: "user", content: "短问题" });
    expect(getConversation(conv.id)!.title).toBe("短问题");

    const long = createConversation("kb_1", "新会话", "usr_1");
    addMessage(long.id, { role: "user", content: "一".repeat(40) });
    expect(getConversation(long.id)!.title).toHaveLength(25); // 24 + ellipsis
    expect(getConversation(long.id)!.title.endsWith("…")).toBe(true);
  });

  it("keeps the first title when more user messages arrive", () => {
    const conv = createConversation("kb_1", "新会话", "usr_1");
    addMessage(conv.id, { role: "user", content: "第一个问题" });
    addMessage(conv.id, { role: "assistant", content: "回答" });
    addMessage(conv.id, { role: "user", content: "第二个问题" });

    expect(getConversation(conv.id)!.title).toBe("第一个问题");
    expect(getConversation(conv.id)!.messages).toHaveLength(3);
  });

  it("falls back to 新会话 for a blank first message", () => {
    const conv = createConversation("kb_1", "新会话", "usr_1");
    addMessage(conv.id, { role: "user", content: "   " });
    expect(getConversation(conv.id)!.title).toBe("新会话");
  });

  it("returns undefined when the conversation does not exist", () => {
    expect(addMessage("conv_missing", { role: "user", content: "hi" })).toBeUndefined();
  });
});

describe("listing", () => {
  it("filters by KB and user, newest first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00Z"));
    const a = createConversation("kb_1", "a", "usr_1");
    vi.setSystemTime(new Date("2026-04-01T00:00:05Z"));
    const b = createConversation("kb_1", "b", "usr_1");
    const other = createConversation("kb_1", "other", "usr_2");
    createConversation("kb_2", "other kb", "usr_1");

    expect(listConversations("kb_1", "usr_1").map((c) => c.id)).toEqual([b.id, a.id]);
    expect(listConversations("kb_1").map((c) => c.id).sort()).toEqual([a.id, b.id, other.id].sort());
    expect(listConversations("kb_1", "usr_2").map((c) => c.id)).toEqual([other.id]);
    vi.useRealTimers();
  });

  it("caps listAllConversations and scopes by user", () => {
    const mine = createConversation("kb_1", "mine", "usr_1");
    createConversation("kb_1", "other", "usr_2");

    expect(listAllConversations(undefined, "usr_1").map((c) => c.id)).toEqual([mine.id]);
    expect(listAllConversations(1).length).toBe(1);
  });

  it("lists shared conversations only", () => {
    const shared = createConversation("kb_1", "shared", "usr_1");
    createConversation("kb_1", "private", "usr_1");
    setConversationShared(shared.id, true);

    expect(listSharedConversations().map((c) => c.id)).toEqual([shared.id]);
    setConversationShared(shared.id, false);
    expect(listSharedConversations()).toEqual([]);
  });
});

describe("conversation flags", () => {
  it("toggles shared / archived and returns undefined for unknown ids", () => {
    const conv = createConversation("kb_1", "c", "usr_1");

    expect(setConversationShared(conv.id, true)!.shared).toBe(true);
    expect(setConversationArchived(conv.id, true)!.archived).toBe(true);
    expect(setConversationShared("conv_missing", true)).toBeUndefined();
    expect(setConversationArchived("conv_missing", true)).toBeUndefined();
  });

  it("normalises tags and caps them at ten", () => {
    const conv = createConversation("kb_1", "c", "usr_1");

    const tagged = setConversationTags(conv.id, ["  退款 ", "", "  ", ...Array.from({ length: 12 }, (_, i) => `t${i}`)])!;

    expect(tagged.tags?.[0]).toBe("退款");
    expect(tagged.tags?.length).toBe(10);
    expect(tagged.tags).not.toContain("");
    expect(setConversationTags("conv_missing", ["x"])).toBeUndefined();
  });
});

describe("message feedback", () => {
  it("records, updates and clears feedback on assistant messages", () => {
    const conv = createConversation("kb_1", "c", "usr_1");
    const assistant = addMessage(conv.id, { role: "assistant", content: "回答" })!;

    expect(setMessageFeedback(conv.id, assistant.id, "down", "引用不准")!.feedback).toBe("down");
    expect(listFeedbackMessages()).toHaveLength(1);
    expect(listFeedbackMessages()[0].message.feedbackNote).toBe("引用不准");

    expect(setMessageFeedback(conv.id, assistant.id, "up")!.feedback).toBe("up");
    expect(listFeedbackMessages()[0].message.feedback).toBe("up");

    const cleared = setMessageFeedback(conv.id, assistant.id, null)!;
    expect(cleared.feedback).toBeUndefined();
    expect(cleared.feedbackNote).toBeUndefined();
    expect(listFeedbackMessages()).toEqual([]);
  });

  it("rejects feedback on user messages and unknown ids", () => {
    const conv = createConversation("kb_1", "c", "usr_1");
    const userMsg = addMessage(conv.id, { role: "user", content: "问题" })!;

    expect(setMessageFeedback(conv.id, userMsg.id, "up")).toBeUndefined();
    expect(setMessageFeedback("conv_missing", "msg_x", "up")).toBeUndefined();
    expect(setMessageFeedback(conv.id, "msg_missing", "up")).toBeUndefined();
  });
});

describe("regenerate + retention", () => {
  it("pops only a trailing assistant message", () => {
    const conv = createConversation("kb_1", "c", "usr_1");
    addMessage(conv.id, { role: "user", content: "问题" });
    const answer = addMessage(conv.id, { role: "assistant", content: "旧回答" })!;

    const popped = popLastAssistantMessage(conv.id)!;
    expect(popped.id).toBe(answer.id);
    expect(getConversation(conv.id)!.messages).toHaveLength(1);

    // Last message is a user message now -> nothing to pop, history untouched.
    expect(popLastAssistantMessage(conv.id)).toBeUndefined();
    expect(getConversation(conv.id)!.messages).toHaveLength(1);
    expect(popLastAssistantMessage("conv_missing")).toBeUndefined();
  });

  it("deletes a single conversation and reports whether it existed", () => {
    const conv = createConversation("kb_1", "c", "usr_1");
    expect(deleteConversation(conv.id)).toBe(true);
    expect(deleteConversation(conv.id)).toBe(false);
  });

  it("counts retention and account-deletion removals per user", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
    const old = createConversation("kb_1", "old", "usr_1");
    vi.setSystemTime(new Date("2026-05-02T00:00:00Z"));
    createConversation("kb_1", "new", "usr_1");
    createConversation("kb_1", "someone else", "usr_2");

    expect(deleteConversationsOlderThan("usr_1", new Date("2026-05-01T12:00:00Z").getTime())).toBe(1);
    expect(getConversation(old.id)).toBeUndefined();

    expect(deleteAllConversations("usr_1")).toBe(1);
    expect(listAllConversations(undefined, "usr_1")).toEqual([]);
    expect(listAllConversations(undefined, "usr_2")).toHaveLength(1);
    vi.useRealTimers();
  });
});
