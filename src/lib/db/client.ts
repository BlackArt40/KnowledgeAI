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
import { log } from "@/lib/obs/log";

let _prisma: PrismaClient | null = null;

/**
 * Get the Prisma client (lazy singleton).
 * Returns null if DATABASE_URL is not set or the client fails to load.
 */
export async function getDb(): Promise<PrismaClient | null> {
  if (!process.env.DATABASE_URL) return null;
  if (_prisma) return _prisma;
  try {
    const { PrismaClient } = await import("@prisma/client");
    _prisma = new PrismaClient() as unknown as PrismaClient;
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
