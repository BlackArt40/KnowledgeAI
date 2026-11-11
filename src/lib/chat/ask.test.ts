// Regression lock for #102: a generation that produces zero tokens must end as
// an `error` frame, must NOT persist an empty assistant message and must NOT be
// counted against the billing meter. Before the fix the provider's failure was
// swallowed in chatStream, so the route happily sent `done` with empty content.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateStream: vi.fn(),
  retrieve: vi.fn(async () => [] as unknown[]),
  suggestFollowUps: vi.fn(async () => [] as string[]),
  recordQa: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/rag/generator", () => ({ generateStream: mocks.generateStream }));
vi.mock("@/lib/rag/retriever", () => ({ retrieve: mocks.retrieve }));
vi.mock("@/lib/rag/conversation-context", () => ({ suggestFollowUps: mocks.suggestFollowUps }));
vi.mock("@/lib/billing/store", () => ({ recordQa: mocks.recordQa }));
vi.mock("@/lib/obs/errors", () => ({ reportError: mocks.reportError }));

import { handleChatRequest } from "./ask";
import { listConversations } from "./store";
import { createKb } from "@/lib/kb/store";
import { findUserByEmail, seed as seedUsers } from "@/lib/auth/store";
import { createToken } from "@/lib/auth/session";
import type { ApiTraceHandle } from "@/lib/obs/trace";

const STORE_KEYS = [
  "__KAI_CHAT_STORE__",
  "__KAI_KB_STORE__",
  "__KAI_USER_STORE__",
  "__KAI_TEAM_STORE__",
  "__KAI_WORKSPACE_STORE__",
  "__KAI_RATE_RECENT__",
  "__KAI_RATE_STATS__",
  "__KAI_NOTIF_STORE__",
  "__KAI_AUDIT_STORE__",
] as const;

beforeEach(() => {
  for (const key of STORE_KEYS) delete (globalThis as Record<string, unknown>)[key];
  seedUsers();
  vi.clearAllMocks();
  mocks.retrieve.mockResolvedValue([]);
  mocks.suggestFollowUps.mockResolvedValue([]);
});

interface Harness {
  kbId: string;
  userId: string;
  req: Request;
  trace: ApiTraceHandle;
}

async function harness(): Promise<Harness> {
  const kb = createKb({ name: "空回答测试", desc: "" }, "usr_owner");
  const user = findUserByEmail("owner@knowledgeai.dev");
  if (!user) throw new Error("seed user missing");
  const token = await createToken({ id: user.id, email: user.email, name: user.name, role: user.role }, 60);
  const req = new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `kai-token=${token}` },
    body: JSON.stringify({ kbId: kb.id, query: "向量检索怎么实现？" }),
  });
  const trace: ApiTraceHandle = {
    traceId: "trace_test",
    end: vi.fn<(status?: number, err?: unknown) => void>(),
  };
  return { kbId: kb.id, userId: user.id, req, trace };
}

describe("handleChatRequest failure paths", () => {
  it("emits empty_response instead of an empty done, without persisting or billing", async () => {
    mocks.generateStream.mockImplementation(async function* () {
      /* provider failed before the first token */
    });
    const { kbId, userId, req, trace } = await harness();

    const res = await handleChatRequest(req, trace, { endpoint: "/api/chat" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const body = await res.text();
    expect(body).toContain('"type":"sources"');
    expect(body).toContain('"type":"error"');
    expect(body).toContain('"code":"empty_response"');
    expect(body).not.toContain('"type":"done"');

    // Billing / follow-up suggestions must not run for a failed answer.
    expect(mocks.recordQa).not.toHaveBeenCalled();
    expect(mocks.suggestFollowUps).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledTimes(1);

    // Trace records the failure (the finally's 200 is a no-op in the real handle).
    expect(trace.end).toHaveBeenCalledWith(500, expect.any(Error));

    // Only the user question is kept: no blank assistant bubble in history.
    const [conv] = listConversations(kbId, userId);
    expect(conv.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("still streams a normal answer and bills it once", async () => {
    mocks.generateStream.mockImplementation(async function* () {
      yield { type: "token" as const, text: "向量检索基于" };
      yield { type: "token" as const, text: "嵌入相似度。" };
      return { text: "向量检索基于嵌入相似度。", citations: [] };
    });
    const { kbId, userId, req, trace } = await harness();

    const res = await handleChatRequest(req, trace, { endpoint: "/api/chat" });
    const body = await res.text();

    expect(body).toContain('"type":"token"');
    expect(body).toContain('"type":"done"');
    expect(body).not.toContain('"type":"error"');

    expect(mocks.recordQa).toHaveBeenCalledTimes(1);
    expect(mocks.recordQa).toHaveBeenCalledWith(userId, expect.any(String));

    const [conv] = listConversations(kbId, userId);
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[1]).toMatchObject({ role: "assistant", content: "向量检索基于嵌入相似度。" });
  });
});
