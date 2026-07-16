// ---------------------------------------------------------------------------
// Queue - factory + public API.
//
// Selects the active JobQueue implementation:
//   - REDIS_URL set + bullmq installed -> BullMQQueue (production)
//   - otherwise -> MemoryQueue (demo / single-instance)
//
// Job handlers are registered in src/lib/queue/handlers.ts and auto-loaded.
//
// An agent event bus (publishAgentEvent / subscribeAgentEvents) relays
// progress from the background agent-run worker to the SSE route. In memory
// mode this is an EventEmitter; with REDIS_URL it uses Redis Pub/Sub so the
// worker can run in a separate process.
// ---------------------------------------------------------------------------

import type { JobQueue, JobType, JobHandler } from "./interface";
import { MemoryQueue } from "./memory-queue";
import { BullMQQueue } from "./bullmq-queue";
import type { AgentEvent } from "@/lib/agent/orchestrator";

let _instance: JobQueue | null = null;
let _handlersRegistered = false;

function getQueue(): JobQueue {
  if (_instance) return _instance;

  // Persist on globalThis so HMR dev reloads don't orphan the worker instance
  // (start() would target the old instance, leaving the new one with running=false).
  const g = globalThis as unknown as { __KAI_QUEUE_INSTANCE__?: JobQueue };
  if (g.__KAI_QUEUE_INSTANCE__) {
    _instance = g.__KAI_QUEUE_INSTANCE__;
    return _instance;
  }

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    _instance = new BullMQQueue(redisUrl);
    console.log("[queue] Backend: BullMQ (Redis)");
  } else {
    _instance = new MemoryQueue();
    console.log("[queue] Backend: Memory (in-process)");
  }
  g.__KAI_QUEUE_INSTANCE__ = _instance;
  return _instance;
}

/** Enqueue a job. Returns a job ID. */
export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>
): Promise<string> {
  ensureHandlers();
  return getQueue().enqueue(type, payload);
}

/** Register a handler for a job type. */
export function registerHandler(type: JobType, handler: JobHandler): void {
  getQueue().registerHandler(type, handler);
}

/** Get a job's status. */
export async function getJobStatus(jobId: string) {
  return getQueue().getJob(jobId);
}

/** Start the queue worker (called on server boot). */
export function startQueue(): void {
  ensureHandlers();
  getQueue().start();
}

/** Graceful shutdown. */
export async function stopQueue(): Promise<void> {
  if (_instance) await _instance.stop();
}

/** Whether a real (Redis-backed) queue is configured. */
export function isQueueExternal(): boolean {
  return !!process.env.REDIS_URL;
}

// Auto-register handlers on first use (lazy, to avoid circular deps at import time).
function ensureHandlers(): void {
  if (_handlersRegistered) return;
  _handlersRegistered = true;
  registerDocHandler();
}

function registerDocHandler(): void {
  // Lazy import to avoid circular dependency at module load time.
  import("./handlers")
    .then(({ registerAllHandlers }) => registerAllHandlers(getQueue()))
    .catch((err) => console.error("[queue] failed to register handlers:", err));
}

// ── Agent Event Bus ───────────────────────────────────────────────────────
//
// Bridges background agent-run worker output to the SSE consumer. Each agent
// task gets a channel keyed by taskId. Subscribers receive AgentEvent objects
// (step / done / error). A "end" sentinel signals the stream should close.

interface AgentBusMessage {
  taskId: string;
  event: AgentEvent | { type: "end" };
}

type Listener = (msg: AgentBusMessage) => void;

const memoryListeners = new Map<string, Set<Listener>>();
let redisPublisher: ((channel: string, message: string) => Promise<void>) | null = null;

function agentChannel(taskId: string): string {
  return `agent:${taskId}`;
}

async function ensureRedisPublisher(): Promise<void> {
  if (redisPublisher || !process.env.REDIS_URL) return;
  try {
    const { publishAgentEventRedis } = await import("./agent-bus-redis");
    redisPublisher = publishAgentEventRedis;
  } catch (err) {
    console.error("[queue] Redis pub/sub unavailable, falling back to in-memory:", err);
  }
}

/** Publish an agent event to subscribers (worker side). */
export async function publishAgentEvent(
  taskId: string,
  event: AgentEvent
): Promise<void> {
  if (process.env.REDIS_URL) {
    await ensureRedisPublisher();
    if (redisPublisher) {
      try {
        await redisPublisher(agentChannel(taskId), JSON.stringify({ taskId, event }));
        return;
      } catch (err) {
        console.error("[queue] redis publish failed, falling back to memory:", err);
      }
    }
  }
  // In-memory fan-out
  const listeners = memoryListeners.get(taskId);
  if (listeners) {
    for (const fn of listeners) {
      try {
        fn({ taskId, event });
      } catch (e) {
        console.error("[queue] agent event listener error:", e);
      }
    }
  }
}

/** Publish the end sentinel so SSE consumers close their stream. */
export async function publishAgentEnd(taskId: string): Promise<void> {
  const endEvent = { type: "end" as const };
  if (process.env.REDIS_URL && redisPublisher) {
    try {
      await redisPublisher(agentChannel(taskId), JSON.stringify({ taskId, event: endEvent }));
      return;
    } catch (err) {
      console.error("[queue] redis publish end failed, falling back to memory:", err);
    }
  }
  const listeners = memoryListeners.get(taskId);
  if (listeners) {
    for (const fn of listeners) {
      try {
        fn({ taskId, event: endEvent });
      } catch (e) {
        console.error("[queue] agent end listener error:", e);
      }
    }
  }
}

/**
 * Subscribe to an agent task's event stream (SSE side). Returns an unsubscribe
 * function. When REDIS_URL is set, subscribes via Redis; otherwise registers
 * an in-memory listener.
 */
export async function subscribeAgentEvents(
  taskId: string,
  onEvent: (event: AgentEvent | { type: "end" }) => void
): Promise<() => void> {
  if (process.env.REDIS_URL) {
    try {
      const { subscribeAgentEventsRedis } = await import("./agent-bus-redis");
      const unsubscribe = await subscribeAgentEventsRedis(taskId, onEvent);
      return unsubscribe;
    } catch (err) {
      console.error("[queue] redis subscribe failed, falling back to memory:", err);
    }
  }

  if (!memoryListeners.has(taskId)) {
    memoryListeners.set(taskId, new Set());
  }
  const listener: Listener = (msg) => onEvent(msg.event);
  memoryListeners.get(taskId)!.add(listener);

  return () => {
    const set = memoryListeners.get(taskId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) memoryListeners.delete(taskId);
    }
  };
}
