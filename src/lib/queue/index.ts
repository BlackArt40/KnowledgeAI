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

import { queueMaxDepth } from "./interface";
import type { JobQueue, JobType, JobHandler, QueueStatsSnapshot } from "./interface";
import { MemoryQueue } from "./memory-queue";
import { BullMQQueue } from "./bullmq-queue";
import type { AgentEvent } from "@/lib/agent/orchestrator";
import { log, redactText } from "@/lib/obs/log";

/** Re-exported so routes can distinguish backpressure from other enqueue
 *  failures and answer with a retryable 503 (`err instanceof ...`). */
export { QueueBackpressureError } from "./interface";

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
    log.info("[queue] Backend: BullMQ (Redis)");
  } else {
    _instance = new MemoryQueue();
    log.info("[queue] Backend: Memory (in-process)");
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

/** Hard bound on the backend stats read. A dead Redis makes BullMQ's
 *  getJobCounts() wait indefinitely (its ioredis runs with
 *  maxRetriesPerRequest: null), and /api/health/ready must answer within
 *  seconds - the unbounded read hung the readiness probe on the
 *  broken-dependency smoke instance (dead REDIS_URL, test-health). */
export const QUEUE_STATS_TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`queue stats timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Backend-neutral queue snapshot for the admin monitoring dashboard. */
export async function getQueueStats(): Promise<QueueStatsSnapshot> {
  const mode = process.env.REDIS_URL ? "redis" : "memory";
  const capturedAt = Date.now();
  try {
    return {
      mode,
      available: true,
      capturedAt,
      queues: await withTimeout(getQueue().getStats(), QUEUE_STATS_TIMEOUT_MS),
    };
  } catch (err) {
    log.error(
      { err: redactText(err instanceof Error ? err.message : String(err)) },
      "[queue] failed to read queue stats"
    );
    return { mode, available: false, capturedAt, queues: [], error: "queue stats unavailable" };
  }
}

/** X5/X6: current backlog vs the QUEUE_MAX_DEPTH cap. `depth` is the largest
 *  per-queue backlog (waiting + delayed); `backpressured` flips when any
 *  queue is at the cap (new jobs are being rejected). Exposed additively on
 *  /api/health/ready so monitoring can alert on it. */
export async function queueBackpressureSnapshot(): Promise<{
  mode: "memory" | "redis";
  available: boolean;
  depth: number;
  maxDepth: number;
  backpressured: boolean;
  queues: { name: string; depth: number }[];
}> {
  const maxDepth = queueMaxDepth();
  const snapshot = await getQueueStats();
  const queues = snapshot.queues.map((q) => ({
    name: q.name,
    depth: q.counts.waiting + q.counts.delayed,
  }));
  const depth = queues.reduce((m, q) => Math.max(m, q.depth), 0);
  return {
    mode: snapshot.mode,
    available: snapshot.available,
    depth,
    maxDepth,
    backpressured: snapshot.available && depth >= maxDepth,
    queues,
  };
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
    .catch((err) => log.error({ err }, "[queue] failed to register handlers"));
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
    log.error({ err }, "[queue] Redis pub/sub unavailable, falling back to in-memory");
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
        log.error({ err }, "[queue] redis publish failed, falling back to memory");
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
        log.error({ err: e }, "[queue] agent event listener error");
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
      log.error({ err }, "[queue] redis publish end failed, falling back to memory");
    }
  }
  const listeners = memoryListeners.get(taskId);
  if (listeners) {
    for (const fn of listeners) {
      try {
        fn({ taskId, event: endEvent });
      } catch (e) {
        log.error({ err: e }, "[queue] agent end listener error");
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
      log.error({ err }, "[queue] redis subscribe failed, falling back to memory");
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
