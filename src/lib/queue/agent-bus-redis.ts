// ---------------------------------------------------------------------------
// Redis Pub/Sub adapter for the agent event bus.
//
// Used when REDIS_URL is set so the agent-run worker (separate process) can
// publish events and the SSE route (web process) can subscribe. Falls back to
// in-memory delivery (in queue/index.ts) if this module or ioredis is absent.
//
// ioredis is dynamically imported and kept as an optional dependency: the app
// runs in demo mode without it. next.config.ts lists it in
// serverExternalPackages.
// ---------------------------------------------------------------------------

import type { AgentEvent } from "@/lib/agent/orchestrator";

// Minimal ioredis surface we depend on (avoids importing types that may not
// exist when ioredis isn't installed).
interface RedisLike {
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<number>;
  unsubscribe(...channels: string[]): Promise<number>;
  on(event: string, listener: (...args: unknown[]) => void): this;
  disconnect(): void;
  duplicate(): RedisLike;
}

interface IORedisCtor {
  new (url: string, opts?: unknown): RedisLike;
}

let _publisher: RedisLike | null = null;
let _subscriber: RedisLike | null = null;
const subscriberChannels = new Map<string, Set<(event: AgentEvent | { type: "end" }) => void>>();

function agentChannel(taskId: string): string {
  return `agent:${taskId}`;
}

async function loadIORedis(): Promise<IORedisCtor | null> {
  try {
    const mod = await import("ioredis");
    return (mod.default ?? mod) as unknown as IORedisCtor;
  } catch {
    console.warn("[agent-bus] ioredis not installed - agent pub/sub disabled");
    return null;
  }
}

async function getPublisher(): Promise<RedisLike | null> {
  if (_publisher) return _publisher;
  const Ctor = await loadIORedis();
  if (!Ctor) return null;
  _publisher = new Ctor(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  return _publisher;
}

async function getSubscriber(): Promise<RedisLike | null> {
  if (_subscriber) return _subscriber;
  const Ctor = await loadIORedis();
  if (!Ctor) return null;
  _subscriber = new Ctor(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  _subscriber.on("message", (channel: unknown, message: unknown) => {
    const ch = channel as string;
    const taskId = ch.startsWith("agent:") ? ch.slice(6) : ch;
    const cbs = subscriberChannels.get(taskId);
    if (!cbs) return;
    let parsed: { event?: AgentEvent | { type: "end" } };
    try {
      parsed = JSON.parse(message as string);
    } catch {
      return;
    }
    if (!parsed.event) return;
    for (const cb of cbs) {
      try {
        cb(parsed.event);
      } catch (e) {
        console.error("[agent-bus] subscriber callback error:", e);
      }
    }
  });
  return _subscriber;
}

/** Publish an agent event to a Redis channel (worker side). */
export async function publishAgentEventRedis(
  channel: string,
  message: string
): Promise<void> {
  const pub = await getPublisher();
  if (!pub) throw new Error("redis publisher unavailable");
  await pub.publish(channel, message);
}

/**
 * Subscribe to an agent task's Redis channel (SSE side). Returns an
 * unsubscribe function that cleans up the channel subscription when the last
 * listener for a task detaches.
 */
export async function subscribeAgentEventsRedis(
  taskId: string,
  onEvent: (event: AgentEvent | { type: "end" }) => void
): Promise<() => void> {
  const sub = await getSubscriber();
  if (!sub) throw new Error("redis subscriber unavailable");

  const channel = agentChannel(taskId);
  let set = subscriberChannels.get(taskId);
  if (!set) {
    set = new Set();
    subscriberChannels.set(taskId, set);
    await sub.subscribe(channel);
  }
  set.add(onEvent);

  return async () => {
    const s = subscriberChannels.get(taskId);
    if (!s) return;
    s.delete(onEvent);
    if (s.size === 0) {
      subscriberChannels.delete(taskId);
      try {
        await sub.unsubscribe(channel);
      } catch {
        // subscriber may already be closed
      }
    }
  };
}
