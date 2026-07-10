// ---------------------------------------------------------------------------
// Per-request model context using AsyncLocalStorage.
// Allows the LLM provider to resolve the current user's model config without
// threading userId through every RAG / agent function signature.
// ---------------------------------------------------------------------------

import { AsyncLocalStorage } from "async_hooks";

const als = new AsyncLocalStorage<string>();

/** Run a function with a userId available to all async descendants. */
export function runWithUser<T>(userId: string, fn: () => Promise<T> | T): Promise<T> | T {
  return als.run(userId, fn);
}

/** Get the current request's userId, or null if not in a model context. */
export function getCurrentUserId(): string | null {
  return als.getStore() ?? null;
}
