// ---------------------------------------------------------------------------
// Realtime event bus (P4-1)
//
// Lightweight in-process pub/sub used by the collaboration features:
//   - KB changes        channel `kb:<kbId>`
//   - Presence          channel `presence`
//   - Shared chat       channel `conv:<conversationId>`
//
// The listener map lives on globalThis so dev HMR doesn't orphan state.
// Single-instance only; a Redis Pub/Sub adapter (like src/lib/queue/
// agent-bus-redis.ts) can be added for multi-instance broadcast.
// ---------------------------------------------------------------------------

import { log } from "@/lib/obs/log";

type Listener = (event: unknown) => void;
type Bus = Map<string, Set<Listener>>;

const g = globalThis as unknown as { __KAI_REALTIME_BUS__?: Bus };

function bus(): Bus {
  if (!g.__KAI_REALTIME_BUS__) g.__KAI_REALTIME_BUS__ = new Map();
  return g.__KAI_REALTIME_BUS__;
}

/** Subscribe to a channel. Returns an unsubscribe function. */
export function subscribe(channel: string, listener: Listener): () => void {
  const b = bus();
  let set = b.get(channel);
  if (!set) {
    set = new Set();
    b.set(channel, set);
  }
  set.add(listener);
  return () => {
    const s = b.get(channel);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) b.delete(channel);
  };
}

/** Publish an event to a channel (listener errors are isolated). */
export function publish(channel: string, event: unknown): void {
  const set = bus().get(channel);
  if (!set) return;
  for (const l of [...set]) {
    try {
      l(event);
    } catch (err) {
      log.error({ err }, "[realtime] listener error");
    }
  }
}
