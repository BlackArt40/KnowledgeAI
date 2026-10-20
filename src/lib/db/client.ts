// ---------------------------------------------------------------------------
// Database Client - lazy Prisma initialization.
//
// The in-memory stores (src/lib/*/store.ts) are used by default for the demo.
// When DATABASE_URL is set, this provides a Prisma client for production
// persistence.
//
// To enable: npx prisma generate && npx prisma migrate deploy (@prisma/client
// is a hard dependency; DATABASE_URL + AUTH_SECRET come from the environment)
// ---------------------------------------------------------------------------

import type { PrismaClient } from "./types";
import { withDbRetry } from "./retry";
import { log } from "@/lib/obs/log";

let _prisma: PrismaClient | null = null;

/**
 * Wrap the Prisma client so every delegate call gets the transient retry
 * layer. Model delegates (`user`, `apiKey`, ...) are plain objects with
 * async methods; the proxy recurses one level and leaves promises/arrays
 * untouched.
 */
function withRetryProxy<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(obj, prop, receiver);
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value === "function") {
        return (...args: unknown[]) =>
          withDbRetry(() => (value as (...a: unknown[]) => Promise<unknown>).apply(obj, args));
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return withRetryProxy(value as object);
      }
      return value;
    },
  }) as T;
}

/**
 * Get the Prisma client (lazy singleton).
 * Returns null if DATABASE_URL is not set or the client fails to load.
 */
export async function getDb(): Promise<PrismaClient | null> {
  if (!process.env.DATABASE_URL) return null;
  if (_prisma) return _prisma;
  try {
    const { PrismaClient } = await import("@prisma/client");
    _prisma = withRetryProxy(new PrismaClient() as unknown as PrismaClient);
    log.info("[db] Prisma client initialized");
    return _prisma;
  } catch {
    log.warn("[db] Prisma client load failed - using in-memory store");
    return null;
  }
}

/** Whether a real database is configured. */
export function isDbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}
