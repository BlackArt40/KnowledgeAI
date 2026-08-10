"use client";
import * as React from "react";

/**
 * Subscribe to an SSE stream via fetch (P4-1 realtime features).
 * Handles buffered `\n\n` frame parsing, ignores comment frames (`: ping`),
 * and reconnects with a backoff delay unless stopped. Returns the last
 * event and a `stop` function.
 */
export function useSse(
  url: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic JSON event handler
  onEvent: (event: any) => void,
  opts?: { enabled?: boolean; reconnectMs?: number }
) {
  const enabled = opts?.enabled ?? true;
  const reconnectMs = opts?.reconnectMs ?? 3000;
  const onEventRef = React.useRef(onEvent);
  React.useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      controller = new AbortController();
      try {
        const res = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        setConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = raw.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue; // comment/heartbeat frames
            try {
              onEventRef.current(JSON.parse(line.slice(5).trim()));
            } catch { /* malformed frame - ignore */ }
          }
        }
      } catch {
        // aborted by stop() -> no reconnect
      } finally {
        setConnected(false);
        if (!cancelled) {
          retryTimer = setTimeout(connect, reconnectMs);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
    };
  }, [url, enabled, reconnectMs]);

  return { connected };
}
