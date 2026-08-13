// P7-2 unit tests: bot integrations (bindings, token hashing, platform parsers).
import { describe, it, expect, beforeEach } from "vitest";
import {
  resetBotStore,
  createBotBinding,
  listBotBindings,
  getBotBinding,
  updateBotBinding,
  deleteBotBinding,
  getBotByToken,
  parsePlatformMessage,
  buildPlatformReply,
  newBotToken,
  hashBotToken,
} from "./bots";

const user = {
  id: "usr_1",
  email: "a@b.c",
  name: "A",
  role: "owner",
  workspaceId: "ws_default",
};

beforeEach(() => {
  resetBotStore();
});

describe("bot bindings", () => {
  it("create returns token once, stores only the SHA-256 hash", async () => {
    const created = await createBotBinding({
      user, name: "财务机器人", platform: "slack", kbId: "kb_1", kbName: "财务报告",
    });
    expect(created).not.toBeNull();
    const { binding, token } = created!;
    expect(token.startsWith("kai_bot_")).toBe(true);
    expect(binding.tokenHash).not.toBe(token);
    expect(binding.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // the plaintext token is never part of the stored binding
    expect(JSON.stringify(binding)).not.toContain(token);
  });

  it("getBotByToken matches by hash; wrong token = undefined", async () => {
    const { binding, token } = (await createBotBinding({
      user, name: "B", platform: "feishu", kbId: "kb_1",
    }))!;
    const found = await getBotByToken(token);
    expect(found?.id).toBe(binding.id);
    expect(await getBotByToken("kai_bot_wrongtoken0000000000000000")).toBeUndefined();
    expect(await getBotByToken("not-a-token")).toBeUndefined();
  });

  it("list is workspace-scoped; update + delete work", async () => {
    await createBotBinding({ user, name: "A", platform: "slack", kbId: "kb_1" });
    const other = {
      id: "usr_2", email: "x@y.z", name: "X", role: "editor", workspaceId: "ws_other",
    };
    const b2 = (await createBotBinding({ user: other, name: "B", platform: "test", kbId: "kb_9" }))!.binding;
    expect(listBotBindings("ws_default").length).toBe(1);
    expect(listBotBindings("ws_other").map((b) => b.id)).toEqual([b2.id]);

    const updated = updateBotBinding(b2.id, { active: false, name: "B2" });
    expect(updated?.active).toBe(false);
    expect(getBotBinding(b2.id)?.name).toBe("B2");
    expect(updateBotBinding("missing", { active: true })).toBeNull();
    expect(deleteBotBinding(b2.id)).toBe(true);
    expect(deleteBotBinding(b2.id)).toBe(false);
  });

  it("tokens are unique and hash deterministically", async () => {
    const t1 = newBotToken();
    const t2 = newBotToken();
    expect(t1).not.toBe(t2);
    expect(await hashBotToken(t1)).toBe(await hashBotToken(t1));
    expect(await hashBotToken(t1)).not.toBe(await hashBotToken(t2));
  });
});

describe("platform adapters", () => {
  it("slack: url_verification challenge + event text", () => {
    expect(parsePlatformMessage("slack", { type: "url_verification", challenge: "abc123" }))
      .toEqual({ text: null, challenge: "abc123" });
    expect(parsePlatformMessage("slack", { type: "event_callback", event: { text: " 你好 " } }))
      .toEqual({ text: "你好", challenge: null });
    expect(parsePlatformMessage("slack", { text: "问题" })).toEqual({ text: "问题", challenge: null });
    expect(parsePlatformMessage("slack", {})).toEqual({ text: null, challenge: null });
  });

  it("feishu: challenge + JSON-encoded message content", () => {
    expect(parsePlatformMessage("feishu", { type: "url_verification", challenge: "feishu-1" }))
      .toEqual({ text: null, challenge: "feishu-1" });
    const content = JSON.stringify({ text: "帮我总结一下" });
    expect(parsePlatformMessage("feishu", { event: { message: { content } } }))
      .toEqual({ text: "帮我总结一下", challenge: null });
    // malformed content JSON -> null text
    expect(parsePlatformMessage("feishu", { event: { message: { content: "not-json" } } }))
      .toEqual({ text: null, challenge: null });
  });

  it("dingtalk: text.content; test platform: raw text", () => {
    expect(parsePlatformMessage("dingtalk", { msgtype: "text", text: { content: "钉钉问题" } }))
      .toEqual({ text: "钉钉问题", challenge: null });
    expect(parsePlatformMessage("test", { text: "原始文本" })).toEqual({ text: "原始文本", challenge: null });
  });

  it("replies use each platform's message format", () => {
    expect(buildPlatformReply("slack", "答", "fallback")).toEqual({ text: "答" });
    expect(buildPlatformReply("feishu", "答", "f")).toEqual({ msg_type: "text", content: { text: "答" } });
    expect(buildPlatformReply("dingtalk", "答", "f")).toEqual({ msgtype: "text", text: { content: "答" } });
    expect(buildPlatformReply("test", "答", "f")).toEqual({ answer: "答", citations: [] });
    // empty answer falls back
    expect(buildPlatformReply("slack", "", "fallback")).toEqual({ text: "fallback" });
  });
});
