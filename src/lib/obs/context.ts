// ---------------------------------------------------------------------------
// Trace context (P6-1): AsyncLocalStorage holding the current request's trace
// record + span stack. Independent from models/context.ts (userId) so the two
// concerns stay decoupled; ALS instances nest freely.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from "async_hooks";
import type { TraceContext } from "./trace";

export const traceAls = new AsyncLocalStorage<TraceContext>();

/** Run fn with a trace context available to all async descendants. */
export function runWithTrace<T>(ctx: TraceContext, fn: () => Promise<T> | T): Promise<T> | T {
  return traceAls.run(ctx, fn);
}

/** The current trace context, or null outside of any traced work. */
export function currentTraceCtx(): TraceContext | null {
  return traceAls.getStore() ?? null;
}
