// ---------------------------------------------------------------------------
// Tiny retry layer for transient Prisma/Postgres failures.
//
// The write-through layer is fire-and-forget: a single connection blip used to
// be logged and lost. This wrapper retries only clearly transient errors
// (connection/pool/timeout/serialization) with a short backoff. Persistent
// failures still surface in logs and in `dbRetrySnapshot()` (readiness probe).
// ---------------------------------------------------------------------------

export interface DbRetryStats {
  attempts: number;
  retries: number;
  failures: number;
  lastErrorAt: number | null;
}

const g = globalThis as unknown as { __KAI_DB_RETRY_STATS__?: DbRetryStats };
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 50;

function stats(): DbRetryStats {
  if (!g.__KAI_DB_RETRY_STATS__) {
    g.__KAI_DB_RETRY_STATS__ = { attempts: 0, retries: 0, failures: 0, lastErrorAt: null };
  }
  return g.__KAI_DB_RETRY_STATS__;
}

export function dbRetrySnapshot(): DbRetryStats {
  return { ...stats() };
}

/** Reset for tests (globalThis survives test files in the same worker). */
export function __resetDbRetryStatsForTest(): void {
  g.__KAI_DB_RETRY_STATS__ = { attempts: 0, retries: 0, failures: 0, lastErrorAt: null };
}

/** Prisma error codes worth retrying: connection/pool/timeout/serialization. */
export function isRetryableDbError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "P1001" || code === "P1002" || code === "P1008"
    || code === "P2024" || code === "P2034";
}

export async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  const s = stats();
  for (let attempt = 0; ; attempt++) {
    s.attempts++;
    try {
      return await fn();
    } catch (err) {
      if (attempt < MAX_RETRIES && isRetryableDbError(err)) {
        s.retries++;
        await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * (attempt + 1)));
        continue;
      }
      s.failures++;
      s.lastErrorAt = Date.now();
      throw err;
    }
  }
}
