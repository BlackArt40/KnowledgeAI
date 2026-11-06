// P0 (batch 1): AI-service remote adapter (phase-1 strangler). Covers the
// switch/env helpers, the JSON POST/DELETE contract, retrieval mapping and the
// SSE pass-through — including the degradation error paths the BFF turns into
// 503 + Retry-After.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  aiServiceLabel,
  aiServiceUrl,
  isAiServiceEnabled,
  remoteClearIndex,
  remoteGenerateStream,
  remoteIndexDocument,
  remoteRetrieve,
} from "./remote";
import type { StreamEvent, StreamResult } from "./generator";

const BASE = "http://ai.local:8080";

const ENV_KEYS = ["AI_SERVICE_URL", "AI_INTERNAL_TOKEN"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

async function collect(
  gen: AsyncGenerator<StreamEvent, StreamResult>
): Promise<{ events: StreamEvent[]; result: StreamResult }> {
  const events: StreamEvent[] = [];
  for (;;) {
    const next = await gen.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

describe("environment helpers", () => {
  it("reports the service as disabled when AI_SERVICE_URL is unset or blank", () => {
    expect(aiServiceUrl()).toBeNull();
    expect(isAiServiceEnabled()).toBe(false);
    expect(aiServiceLabel()).toBe("");

    process.env.AI_SERVICE_URL = "   ";
    expect(aiServiceUrl()).toBeNull();
    expect(isAiServiceEnabled()).toBe(false);
  });

  it("strips trailing slashes from the base URL", () => {
    process.env.AI_SERVICE_URL = "http://ai.local:8080///";
    expect(aiServiceUrl()).toBe("http://ai.local:8080");
    expect(isAiServiceEnabled()).toBe(true);
  });

  it("exposes the trimmed raw value as a label", () => {
    process.env.AI_SERVICE_URL = "  http://ai.local:8080/ ";
    expect(aiServiceLabel()).toBe("http://ai.local:8080/");
  });
});

describe("remoteIndexDocument", () => {
  const payload = {
    workspaceId: "ws_1",
    kbId: "kb_1",
    docId: "doc_1",
    filename: "a.md",
    source: { type: "content" as const, content: "# hi" },
    settings: { chunkSize: 200, chunkOverlap: 20 },
  };

  it("throws before any network call when the service is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(remoteIndexDocument(payload)).rejects.toThrow("AI_SERVICE_URL not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the payload with the internal token and trace id", async () => {
    process.env.AI_SERVICE_URL = BASE;
    process.env.AI_INTERNAL_TOKEN = "internal-token";
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true, chunks: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(remoteIndexDocument(payload, "trace-1")).resolves.toEqual({ ok: true, chunks: 3 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/internal/index`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Internal-Token": "internal-token",
      "X-Trace-Id": "trace-1",
    });
    expect(JSON.parse(String(init.body))).toEqual(payload);
  });

  it("rejects a non-JSON response body", async () => {
    process.env.AI_SERVICE_URL = BASE;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(null)));

    await expect(remoteIndexDocument(payload)).rejects.toThrow("AI service returned non-JSON (200)");
  });

  it("rejects when the body cannot be parsed at all", async () => {
    process.env.AI_SERVICE_URL = BASE;
    const bad = new Response("<html>gateway</html>", { status: 502 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bad));

    await expect(remoteIndexDocument(payload)).rejects.toThrow("AI service returned non-JSON (502)");
  });
});

describe("remoteClearIndex", () => {
  it("throws when the service is not configured", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(remoteClearIndex({ workspaceId: "ws_1", kbId: "kb_1" })).rejects.toThrow(
      "AI_SERVICE_URL not configured"
    );
  });

  it("deletes one document and carries the workspace as a query parameter", async () => {
    process.env.AI_SERVICE_URL = BASE;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await remoteClearIndex({ workspaceId: "ws 1", kbId: "kb/1", docId: "doc 1" }, "trace-2");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/internal/index/kb%2F1/doc%201?workspaceId=ws%201`);
    expect(init.method).toBe("DELETE");
    expect(init.headers).toMatchObject({ "X-Trace-Id": "trace-2" });
  });

  it("deletes a whole knowledge base without a workspace parameter", async () => {
    process.env.AI_SERVICE_URL = BASE;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await remoteClearIndex({ kbId: "kb_1" });

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`${BASE}/internal/index/kb_1`);
  });

  it("throws on a non-2xx delete", async () => {
    process.env.AI_SERVICE_URL = BASE;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    await expect(remoteClearIndex({ workspaceId: "ws_1", kbId: "kb_1" })).rejects.toThrow(
      "AI service clear index failed (HTTP 403)"
    );
  });
});

describe("remoteRetrieve", () => {
  it("maps chunks and keeps only the optional fields that are present", async () => {
    process.env.AI_SERVICE_URL = BASE;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          ok: true,
          chunks: [
            { docId: "d1", docName: "a.md", chunkIndex: 2, text: "hello", score: 0.9, url: "https://x/1" },
            { docId: "d2", docName: "b.md", chunkIndex: "3", text: "world", score: "0.5", sourceType: "web" },
            "not-a-record",
            null,
          ],
        })
      )
    );

    const out = await remoteRetrieve("ws_1", "kb_1", "q", 5, "trace-3");

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      docId: "d1",
      docName: "a.md",
      chunkIndex: 2,
      text: "hello",
      score: 0.9,
      url: "https://x/1",
    });
    expect(out[1]).toEqual({
      docId: "d2",
      docName: "b.md",
      chunkIndex: 3,
      text: "world",
      score: 0.5,
      sourceType: "web",
    });
    expect(out[1]).not.toHaveProperty("url");
  });

  it("fills defaults for missing fields", async () => {
    process.env.AI_SERVICE_URL = BASE;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ok: true, chunks: [{}] })));

    await expect(remoteRetrieve("ws_1", "kb_1", "q", 3)).resolves.toEqual([
      { docId: "", docName: "", chunkIndex: 0, text: "", score: 0 },
    ]);
  });

  it.each([
    [{ ok: false, chunks: [] }],
    [{ ok: true }],
    [{ ok: true, chunks: "nope" }],
  ])("throws when the service reports a failed retrieve (%j)", async (body) => {
    process.env.AI_SERVICE_URL = BASE;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(body)));

    await expect(remoteRetrieve("ws_1", "kb_1", "q", 3)).rejects.toThrow("AI service retrieve failed");
  });
});

describe("remoteGenerateStream", () => {
  const opts = {
    workspaceId: "ws_1",
    kbId: "kb_1",
    query: "hi",
    chunks: [{ docId: "d1", docName: "a.md", chunkIndex: 0, text: "ctx", score: 0.9 }],
  };

  it("throws when the service is not configured", async () => {
    await expect(collect(remoteGenerateStream(opts))).rejects.toThrow("AI_SERVICE_URL not configured");
  });

  it("rejects a non-2xx stream response", async () => {
    process.env.AI_SERVICE_URL = BASE;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(collect(remoteGenerateStream(opts))).rejects.toThrow(
      "AI service chat stream failed (HTTP 503)"
    );
  });

  it("rejects a response without a body", async () => {
    process.env.AI_SERVICE_URL = BASE;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(collect(remoteGenerateStream(opts))).rejects.toThrow(
      "AI service chat stream failed (HTTP 200)"
    );
  });

  it("yields tokens across chunk boundaries and returns the done payload", async () => {
    process.env.AI_SERVICE_URL = BASE;
    const fetchMock = vi.fn().mockResolvedValue(
      sse([
        // sources frame is skipped (BFF already sent its own)
        'data: {"type":"sources","chunks":[]}\n\n',
        // token split mid-frame across two reads
        'data: {"type":"to',
        'ken","text":"Hel"}\n\n',
        'data: {"type":"token","text":"lo"}\n\n',
        // malformed + non-record frames are ignored
        "data: {oops\n\n",
        "data: 42\n\n",
        ": keep-alive comment\n\n",
        // done carries citations, including optional fields
        'data: {"type":"done","text":"Hello","citations":[{"n":1,"docId":"d1","docName":"a.md","chunkIndex":0,"snippet":"ctx","score":0.9,"url":"https://x/1"},{"n":2,"docId":"d2","docName":"b.md","chunkIndex":1,"snippet":"s","score":0.1}]}\n\n',
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const { events } = await collect(remoteGenerateStream({ ...opts, temperature: 0.7, history: [] }));

    expect(events).toEqual([
      { type: "token", text: "Hel" },
      { type: "token", text: "lo" },
    ]);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ workspaceId: "ws_1", kbId: "kb_1", query: "hi", temperature: 0.7 });
    expect(body.conversationId).toBe("");
  });

  it("forwards the client abort signal", async () => {
    process.env.AI_SERVICE_URL = BASE;
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(sse(['data: {"type":"done","text":""}\n\n']));
    vi.stubGlobal("fetch", fetchMock);

    await collect(remoteGenerateStream({ ...opts, signal: controller.signal }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("returns an empty text when the done frame has no text", async () => {
    process.env.AI_SERVICE_URL = BASE;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(['data: {"type":"done"}\n\n'])));

    const { events, result } = await collect(remoteGenerateStream(opts));

    expect(events).toEqual([]);
    expect(result).toEqual({ text: "", citations: [] });
  });

  it("throws when the service sends an error frame", async () => {
    process.env.AI_SERVICE_URL = BASE;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sse(['data: {"type":"error","message":"model overloaded"}\n\n']))
    );

    await expect(collect(remoteGenerateStream(opts))).rejects.toThrow("model overloaded");
  });

  it("falls back to a generic message for an error frame without one", async () => {
    process.env.AI_SERVICE_URL = BASE;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(['data: {"type":"error"}\n\n'])));

    await expect(collect(remoteGenerateStream(opts))).rejects.toThrow("AI service generation error");
  });

  it("throws when the stream ends without a done frame", async () => {
    process.env.AI_SERVICE_URL = BASE;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sse(['data: {"type":"token","text":"partial"}\n\n']))
    );

    await expect(collect(remoteGenerateStream(opts))).rejects.toThrow(
      "AI service stream ended without done frame"
    );
  });
});
