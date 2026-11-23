import { describe, expect, it, vi } from "vitest";
import { createSseResponse } from "./sse-produce";

describe("createSseResponse", () => {
  it("writes data frames and closes once", async () => {
    const cleanup = vi.fn();
    const req = new Request("http://localhost/events");
    const res = createSseResponse(req, (sse) => {
      sse.send({ type: "init" });
      sse.close();
      return cleanup;
    });

    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await res.text()).toBe('data: {"type":"init"}\n\n');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("runs cleanup when the request aborts before handler settles", async () => {
    const ac = new AbortController();
    const cleanup = vi.fn();
    const req = new Request("http://localhost/events", { signal: ac.signal });

    const res = createSseResponse(req, () => cleanup);
    ac.abort();
    await res.text().catch(() => undefined);
    expect(cleanup).toHaveBeenCalled();
  });

  it("calls onTimeout and closes the stream", async () => {
    const req = new Request("http://localhost/events");
    const onTimeout = vi.fn();
    const res = createSseResponse(
      req,
      (sse) => {
        sse.send({ type: "init" });
      },
      { heartbeatMs: 40, timeoutMs: 300, onTimeout }
    );

    // Reading the body starts the stream (and its timers).
    const body = res.text();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(await body).toContain('data: {"type":"init"}');
  });
});
