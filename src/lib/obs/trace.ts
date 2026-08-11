// ---------------------------------------------------------------------------
// Tracing (P6-1): lightweight distributed tracing over AsyncLocalStorage.
//
// A trace is rooted by `withApiTrace` (route handlers) or `runWithTrace`
// (background jobs). `withSpan` / `traceBegin`+`traceEnd` record child spans
// from library code (RAG / LLM / doc processing) with zero overhead when no
// trace context is active. traceId propagates via the `X-Trace-Id` header;
// spans are kept in a bounded in-memory ring (`__KAI_TRACE_STORE__`).
//
// Why not the OpenTelemetry SDK: it is a heavy dependency and its Next.js 16
// + Edge middleware integration is fragile for this repo's zero-dependency
// convention. The acceptance (full-chain traceability API -> RAG -> LLM ->
// response) is met natively; swapping in OTel exporters later only requires
// adapting the span model below.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { runWithTrace, traceAls } from "./context";
import { recordRequest } from "./metrics";
import { log } from "./log";

export type SpanKind = "api" | "rag" | "llm" | "doc" | "agent" | "external";

export type SpanAttrs = Record<string, string | number | boolean>;

export interface Span {
  spanId: string;
  traceId: string;
  parentId: string | null;
  name: string;
  kind: SpanKind;
  start: number; // epoch ms
  end: number;
  durationMs: number;
  status: "ok" | "error";
  error?: string;
  attrs: SpanAttrs;
}

export interface TraceRecord {
  traceId: string;
  name: string;
  status: "ok" | "error";
  source: "api" | "queue";
  start: number;
  end: number;
  durationMs: number;
  spans: Span[];
  error?: string;
}

/** ALS payload: the trace being built + the stack of open spans. */
export interface TraceContext {
  traceId: string;
  record: TraceRecord;
  stack: Span[];
}

export interface ApiTraceHandle {
  traceId: string;
  /** Finalize the trace (idempotent). Call from SSE stream finally when
   *  using autoEnd:false, otherwise withApiTrace finalizes on return. */
  end: (status?: number, err?: unknown) => void;
}

const TRACE_CAP = 300;

declare global {
  var __KAI_TRACE_STORE__: TraceRecord[] | undefined;
}

function traces(): TraceRecord[] {
  if (!globalThis.__KAI_TRACE_STORE__) globalThis.__KAI_TRACE_STORE__ = [];
  return globalThis.__KAI_TRACE_STORE__;
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function pushTrace(record: TraceRecord): void {
  const t = traces();
  t.unshift(record);
  if (t.length > TRACE_CAP) t.length = TRACE_CAP;
}

export function getTrace(traceId: string): TraceRecord | undefined {
  return traces().find((t) => t.traceId === traceId);
}

export function listTraces(limit = 20): TraceRecord[] {
  return traces().slice(0, limit);
}

function finalizeRecord(record: TraceRecord, status?: number, err?: unknown): void {
  if (record.end > 0) return; // idempotent
  const now = Date.now();
  record.end = now;
  record.durationMs = now - record.start;
  if (err) {
    record.status = "error";
    record.error = err instanceof Error ? err.message : String(err);
  }
  const root = record.spans[0];
  if (root) {
    root.end = now;
    root.durationMs = now - root.start;
    root.status = record.status;
    if (err) root.error = record.error;
    // api root spans also feed the request SLI (status-aware, since the
    // middleware cannot observe downstream responses in Next 16).
    if (root.kind === "api") {
      const code = status ?? (record.status === "error" ? 500 : 200);
      recordRequest(code, root.durationMs);
      // P6-2: one structured line per request/queue run, correlated with the
      // same requestId (mixin reads the ALS context we are still inside).
      if (record.source === "api") {
        log.info(
          {
            method: typeof root.attrs.method === "string" ? root.attrs.method : "",
            path: typeof root.attrs.path === "string" ? root.attrs.path : "",
            status: code,
            durationMs: root.durationMs,
          },
          "http.response"
        );
      } else {
        log.info({ job: record.name, status: code, durationMs: record.durationMs }, "queue.finish");
      }
    }
  }
  pushTrace(record);
}

function newRecord(traceId: string, name: string, source: TraceRecord["source"]): TraceRecord {
  const now = Date.now();
  return { traceId, name, status: "ok", source, start: now, end: 0, durationMs: 0, spans: [], error: undefined };
}

function pushSpan(ctx: TraceContext, span: Span): void {
  ctx.record.spans.push(span);
  ctx.stack.push(span);
}

function popSpan(ctx: TraceContext, span: Span, err?: unknown): void {
  span.end = Date.now();
  span.durationMs = span.end - span.start;
  if (err) {
    span.status = "error";
    span.error = err instanceof Error ? err.message : String(err);
    ctx.record.status = "error";
  }
  const top = ctx.stack[ctx.stack.length - 1];
  if (top === span) ctx.stack.pop();
}

/**
 * Wrap a route handler in a trace: reads/generates `X-Trace-Id`, records the
 * api root span + request SLI, and gives async descendants (RAG/LLM calls)
 * the trace context via AsyncLocalStorage.
 *
 * `autoEnd:false` is for SSE routes whose lifetime outlives the returned
 * Response - the stream's finally must call `handle.end(status)`.
 */
export async function withApiTrace<T>(
  req: Request,
  name: string,
  fn: (handle: ApiTraceHandle) => Promise<T>,
  opts: { autoEnd?: boolean } = {}
): Promise<T> {
  const autoEnd = opts.autoEnd !== false;
  const traceId = req.headers.get("x-trace-id") ?? req.headers.get("x-middleware-request-x-trace-id") ?? randomUUID();
  const record = newRecord(traceId, name, "api");
  const now = Date.now();
  const root: Span = {
    spanId: uid("span"),
    traceId,
    parentId: null,
    name,
    kind: "api",
    start: now,
    end: 0,
    durationMs: 0,
    status: "ok",
    attrs: { method: req.method, path: new URL(req.url).pathname },
  };
  record.spans.push(root);
  const ctx: TraceContext = { traceId, record, stack: [root] };
  const handle: ApiTraceHandle = {
    traceId,
    end: (status?, err?) => finalizeRecord(record, status, err),
  };
  return runWithTrace(ctx, async () => {
    try {
      const result = await fn(handle);
      if (autoEnd) {
        const status = result instanceof Response ? result.status : 200;
        finalizeRecord(record, status);
      }
      return result;
    } catch (err) {
      if (!autoEnd || record.end === 0) finalizeRecord(record, 500, err);
      throw err;
    }
  }) as Promise<T>;
}

/** Background-job trace root (queue handlers receive traceId via job payload). */
export async function runWithTraceId<T>(traceId: string | undefined, name: string, fn: () => Promise<T>): Promise<T> {
  const record = newRecord(traceId ?? randomUUID(), name, "queue");
  const now = Date.now();
  const root: Span = { spanId: uid("span"), traceId: record.traceId, parentId: null, name, kind: "api", start: now, end: 0, durationMs: 0, status: "ok", attrs: {} };
  record.spans.push(root);
  const ctx: TraceContext = { traceId: record.traceId, record, stack: [root] };
  return runWithTrace(ctx, async () => {
    try {
      const result = await fn();
      finalizeRecord(record, 200);
      return result;
    } catch (err) {
      finalizeRecord(record, 500, err);
      throw err;
    }
  }) as Promise<T>;
}

/**
 * Record a child span around async work. No-op when not inside a trace
 * (library code stays zero-cost outside traced requests).
 */
export async function withSpan<T>(
  name: string,
  kind: SpanKind,
  attrs: SpanAttrs,
  fn: () => Promise<T>
): Promise<T> {
  const h = traceBegin(name, kind, attrs);
  if (!h) return fn();
  try {
    const result = await fn();
    traceEnd(h);
    return result;
  } catch (err) {
    traceEnd(h, err);
    throw err;
  }
}

export interface SpanHandle {
  span: Span;
  ctx: TraceContext;
}

/** Open a span manually (for generators / long-lived work). Null outside a trace. */
export function traceBegin(name: string, kind: SpanKind, attrs: SpanAttrs = {}): SpanHandle | null {
  const ctx = traceAls.getStore() ?? null;
  if (!ctx) return null;
  const parent = ctx.stack[ctx.stack.length - 1];
  const span: Span = {
    spanId: uid("span"),
    traceId: ctx.traceId,
    parentId: parent ? parent.spanId : null,
    name,
    kind,
    start: Date.now(),
    end: 0,
    durationMs: 0,
    status: "ok",
    attrs,
  };
  pushSpan(ctx, span);
  return { span, ctx };
}

/** Close a span opened with traceBegin (no-op for null - no trace context). */
export function traceEnd(h: SpanHandle | null, err?: unknown): void {
  if (h) popSpan(h.ctx, h.span, err);
}
