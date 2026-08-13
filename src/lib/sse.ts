// ---------------------------------------------------------------------------
// Shared SSE frame consumer (P7) - isomorphic (Node 18+ / browser).
//
// One implementation of the `data: {json}\n\n` frame protocol used by
// /api/chat and /api/agent/run, shared by the chat page (client), ask-once
// (server-side bot answers) and the v1 SDK surface. Wire format changes must
// only ever be applied here + the cross-language SDKs (separate deployables).
// ---------------------------------------------------------------------------

export type SseEvent = Record<string, unknown>;

/**
 * Read a text/event-stream Response and invoke `onEvent` for every parsed
 * `data:` frame. Malformed frames are skipped (never throw the consumer).
 * Resolves when the stream ends or the reader errors.
 */
export async function consumeSseStream(
  res: Response,
  onEvent: (event: SseEvent) => void | Promise<void>
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        const event = JSON.parse(line.slice(5).trim()) as SseEvent;
        await onEvent(event);
      } catch {
        // malformed frame - skip
      }
    }
  }
}
