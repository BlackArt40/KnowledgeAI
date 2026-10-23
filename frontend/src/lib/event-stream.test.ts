import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeEvents } from "./event-stream";

const enc = new TextEncoder();

function responseWith(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("subscribeEvents", () => {
  it("按 data: 帧回调，跳过 ping 注释帧", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      responseWith([': ping\n\n', 'data: {"type":"init"}\n\n', 'data: {"type":"docs","doc":{"id":"d1"}}\n\n'])
    );
    vi.stubGlobal("fetch", fetchMock);

    const events: Record<string, unknown>[] = [];
    const handle = subscribeEvents("/api/knowledge-base/kb1/events", {
      onEvent: (e) => events.push(e),
      reconnectMs: 0,
    });

    await vi.waitFor(() => expect(events).toHaveLength(2));
    handle.stop();
    expect(events[0]).toMatchObject({ type: "init" });
    expect(events[1]).toMatchObject({ type: "docs", doc: { id: "d1" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("403 属确定性失败：不重连（未共享会话）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    const handle = subscribeEvents("/api/chat/conversations/c1/events", {
      onEvent: () => {},
      reconnectMs: 5,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("stop() 之后不再把帧派发给消费者", async () => {
    const sink: { push: ((chunk: string) => void) | null } = { push: null };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        sink.push = (chunk: string) => {
          try {
            controller.enqueue(enc.encode(chunk));
          } catch {
            /* 流已关闭 */
          }
        };
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const events: unknown[] = [];
    const handle = subscribeEvents("/api/team/presence/events", {
      onEvent: (e) => events.push(e),
      reconnectMs: 0,
    });
    await vi.waitFor(() => expect(sink.push).not.toBeNull());

    sink.push?.('data: {"type":"presence","online":[]}\n\n');
    await vi.waitFor(() => expect(events).toHaveLength(1));

    handle.stop();
    sink.push?.('data: {"type":"presence","online":[]}\n\n');
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toHaveLength(1);
  });
});
