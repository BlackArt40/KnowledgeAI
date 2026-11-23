// ---------------------------------------------------------------------------
// Shared SSE producer for Route Handlers.
//
// The consumer side lives in ./sse.ts. This side owns the repetitive parts:
// encoder, idempotent close, abort/cancel cleanup, heartbeat, idle timeout,
// and the response headers. Callers only subscribe, send frames, and return a
// cleanup function.
// ---------------------------------------------------------------------------

import { log } from "@/lib/obs/log";

export interface SseProducer {
  /** Send `data: <json>\n\n`; returns false once the client is gone. */
  send: (event: unknown) => boolean;
  /** Send a raw frame (used for `: ping`). */
  raw: (frame: string) => boolean;
  /** Close once; runs the handler cleanup. */
  close: () => void;
  /** Reset the idle timeout clock. */
  touch: () => void;
  readonly closed: boolean;
  readonly signal: AbortSignal;
}

export interface SseProducerOptions {
  /** Defaults to 30s. Set 0 to disable. */
  heartbeatMs?: number;
  /** Optional idle hard timeout; calls onTimeout then closes. */
  timeoutMs?: number;
  onTimeout?: (sse: SseProducer) => void;
  /** Called on every heartbeat tick (e.g. refresh presence TTL). */
  onHeartbeat?: (sse: SseProducer) => void;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

type Cleanup = void | (() => void) | null;
type Handler = (sse: SseProducer) => Cleanup | Promise<Cleanup>;

/**
 * Build a text/event-stream Response.
 *
 * The handler runs inside `start()`. It may be async (e.g. subscribe to an
 * async bus); its returned cleanup runs exactly once on close/abort/cancel.
 */
export function createSseResponse(
  req: Request,
  handler: Handler,
  options: SseProducerOptions = {}
): Response {
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const timeoutMs = options.timeoutMs;
  const enc = new TextEncoder();

  let cancelStream: () => void = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let cleanup: (() => void) | undefined;
      let cleanupRun = false;
      let lastActivityAt = Date.now();
      let timer: ReturnType<typeof setInterval> | null = null;

      const runCleanup = () => {
        if (cleanupRun) return;
        cleanupRun = true;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        try {
          cleanup?.();
        } catch {
          /* cleanup is best-effort */
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        req.signal.removeEventListener("abort", close);
        runCleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      cancelStream = close;

      const raw = (frame: string): boolean => {
        if (closed || req.signal.aborted) return false;
        try {
          controller.enqueue(enc.encode(frame));
          return true;
        } catch {
          close();
          return false;
        }
      };

      const sse: SseProducer = {
        send: (event) => {
          const ok = raw(`data: ${JSON.stringify(event)}\n\n`);
          if (ok) lastActivityAt = Date.now();
          return ok;
        },
        raw,
        close,
        touch: () => {
          lastActivityAt = Date.now();
        },
        get closed() {
          return closed;
        },
        signal: req.signal,
      };

      req.signal.addEventListener("abort", close, { once: true });

      const tickMs = timeoutMs
        ? Math.min(heartbeatMs || 30_000, Math.max(250, Math.floor(timeoutMs / 2)))
        : heartbeatMs;

      if (tickMs > 0) {
        timer = setInterval(() => {
          if (closed) return;
          const idleMs = Date.now() - lastActivityAt;
          if (timeoutMs && idleMs >= timeoutMs) {
            options.onTimeout?.(sse);
            close();
            return;
          }
          if (heartbeatMs > 0) {
            options.onHeartbeat?.(sse);
            // Heartbeats keep proxies alive but must not reset the idle
            // timeout - otherwise a silent worker could keep a stream open
            // forever just by pinging.
            if (idleMs >= heartbeatMs) raw(": ping\n\n");
          }
        }, tickMs);
        (timer as unknown as { unref?: () => void }).unref?.();
      }

      let result: ReturnType<Handler>;
      try {
        // Start synchronously so request-scoped work (subscribe/enqueue) is
        // visible to the caller before the Response is returned.
        result = handler(sse);
      } catch (err) {
        log.error({ err }, "[sse-produce] handler failed");
        close();
        return;
      }

      void Promise.resolve(result)
        .then((fn) => {
          cleanup = fn ?? undefined;
          if (!fn) return;
          if (closed || cleanupRun) {
            try {
              fn();
            } catch {
              /* cleanup is best-effort */
            }
          }
        })
        .catch((err) => {
          log.error({ err }, "[sse-produce] handler failed");
          close();
        });
    },
    cancel() {
      // Client disconnected without an abort (e.g. tab closed).
      cancelStream();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
