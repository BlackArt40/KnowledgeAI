// ---------------------------------------------------------------------------
// Database Client — lazy Prisma initialization.
//
// The in-memory stores (src/lib/*/store.ts) are used by default for the demo.
// When DATABASE_URL is set and @prisma/client is installed, this provides
// a Prisma client for production persistence.
//
// 🔌 To enable: pnpm add @prisma/client && npx prisma generate && npx prisma migrate deploy
// ---------------------------------------------------------------------------

let _prisma: unknown = null;

/**
 * Get the Prisma client (lazy singleton).
 * Returns null if @prisma/client is not installed or DATABASE_URL not set.
 */
export async function getDb(): Promise<unknown | null> {
  if (!process.env.DATABASE_URL) return null;
  if (_prisma) return _prisma;
  try {
    const { PrismaClient } = await import("@prisma/client");
    _prisma = new PrismaClient();
    console.log("[db] Prisma client initialized");
    return _prisma;
  } catch {
    console.warn("[db] @prisma/client not installed — using in-memory store");
    return null;
  }
}

/** Whether a real database is configured. */
export function isDbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}
