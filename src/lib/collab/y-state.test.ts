// Phase 2a: Yjs 权威状态——并发/乱序合并、快照、版本变化后重建。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(async () => "job_collab") }));

import {
  applyCollabUpdate,
  destroyCollabState,
  flushCollabSnapshot,
  getCollabState,
} from "./y-state";
import { addDocument, createKb, getDocument, saveDocumentContent } from "@/lib/kb/store";

const OWNER = { id: "usr_owner", email: "owner@knowledgeai.dev", name: "张明（Owner）" };

function fixture() {
  const kb = createKb({ name: "协同编辑验收", desc: "" }, OWNER.id, "ws_default");
  const doc = addDocument({
    kbId: kb.id,
    name: "collab.md",
    size: 8,
    content: "hello",
    skipEnqueue: true,
  });
  return { kb, doc };
}

function clientFrom(update: string): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(update, "base64")));
  return doc;
}
function updateB64(doc: Y.Doc): string {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
}

beforeEach(() => {
  for (const key of [
    "__KAI_KB_STORE__",
    "__KAI_USER_STORE__",
    "__KAI_TEAM_STORE__",
    "__KAI_WORKSPACE_STORE__",
    "__KAI_COLLAB_STATE__",
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Yjs 文档状态", () => {
  it("两个客户端并发编辑，快照包含双方内容", () => {
    const { doc } = fixture();
    const state = getCollabState(doc.id)!;
    expect(state.version).toBe(1);

    const a = clientFrom(state.update);
    const b = clientFrom(state.update);
    a.getText("content").insert(5, "A");
    b.getText("content").insert(5, "B");

    expect(applyCollabUpdate(doc.id, updateB64(a)).ok).toBe(true);
    expect(applyCollabUpdate(doc.id, updateB64(b)).ok).toBe(true);

    const text = flushCollabSnapshot(doc.id)!;
    expect(text).toContain("hello");
    expect(text).toContain("A");
    expect(text).toContain("B");
    expect(text.length).toBe(7);
    expect(getDocument(doc.id)?.content).toBe(text);
    expect(getDocument(doc.id)?.version).toBe(2);
  });

  it("乱序到达的 update 仍可合并（CRDT 交换律）", () => {
    const { doc } = fixture();
    const base = getCollabState(doc.id)!.update;

    const c1 = clientFrom(base);
    c1.getText("content").insert(0, "1");
    const u1 = updateB64(c1);
    const c2 = clientFrom(base);
    c2.getText("content").insert(0, "2");
    const u2 = updateB64(c2);

    applyCollabUpdate(doc.id, u2);
    applyCollabUpdate(doc.id, u1);
    const text = flushCollabSnapshot(doc.id)!;
    expect(text).toContain("1");
    expect(text).toContain("2");
    expect(text).toContain("hello");
  });

  it("正文版本变化后重建 Y.Doc（Phase 1 保存不会丢）", () => {
    const { doc } = fixture();
    getCollabState(doc.id);
    saveDocumentContent(doc.id, "v2 body", "王浩（Editor）");

    const state = getCollabState(doc.id)!;
    expect(state.version).toBe(2);
    const client = clientFrom(state.update);
    expect(client.getText("content").toString()).toBe("v2 body");
  });

  it("无变化时不产生快照；非法 update / 超大 update 被拒", () => {
    const { doc } = fixture();
    getCollabState(doc.id);
    expect(flushCollabSnapshot(doc.id)).toBeNull();

    expect(applyCollabUpdate(doc.id, "!!!").ok).toBe(false);
    const huge = Buffer.alloc(600 * 1024, 1).toString("base64");
    expect(applyCollabUpdate(doc.id, huge)).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("destroy 后重建仍从快照恢复", () => {
    const { doc } = fixture();
    const state = getCollabState(doc.id)!;
    const c = clientFrom(state.update);
    c.getText("content").insert(5, "!");
    applyCollabUpdate(doc.id, updateB64(c));
    flushCollabSnapshot(doc.id);
    destroyCollabState(doc.id);

    const rebuilt = clientFrom(getCollabState(doc.id)!.update);
    expect(rebuilt.getText("content").toString()).toBe("hello!");
  });
});
