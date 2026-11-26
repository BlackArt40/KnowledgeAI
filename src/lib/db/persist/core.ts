// ---------------------------------------------------------------------------
// Persistence - write-through layer that syncs in-memory store mutations
// to PostgreSQL.
//
// Each function is a fire-and-forget async operation:
//   - If DB is enabled: writes to Prisma (errors logged, not thrown)
//   - If DB is not configured: no-op
//
// The in-memory store remains the source of truth for reads (ADR-0001). The DB
// is the recovery copy that survives restarts; multi-instance shared reads still
// need a separate evolution per that ADR.
// ---------------------------------------------------------------------------




import { log } from "@/lib/obs/log";

/**
 * Best-effort persistence helper. Deletes are idempotent, so a P2025 ("row not
 * found") is expected and ignored; every other failure is logged. Previously
 * these paths used `.catch((err) => bestEffort(err))`, which silently diverged memory from DB.
 */
export function bestEffort(err: unknown): void {
  if ((err as { code?: string } | null)?.code === "P2025") return;
  log.error({ err }, "[db] best-effort persistence operation failed");
}

/** Persist a user create/update to DB. */

export function isForeignKeyViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2003"
  );
}


export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parent-row FK race: total ~500ms of patience across 4 retries. */
const FK_MAX_RETRIES = 4;
const FK_RETRY_BASE_MS = 50;

/**
 * Run a child-row write that can race ahead of its parent row.
 *
 * Every write in this module is fire-and-forget (the in-memory store is the
 * read path), so a P2003 here is transient - the parent INSERT is still in
 * flight. Retry briefly instead of silently dropping the child row. Shared by
 * document (KbDocument -> KnowledgeBase), message
 * (Message -> Conversation) and message-feedback writes.
 */

export async function withFkRetry<T>(write: () => Promise<T>, label: string): Promise<T | undefined> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (err) {
      if (isForeignKeyViolation(err) && attempt < FK_MAX_RETRIES) {
        await sleep(FK_RETRY_BASE_MS * (attempt + 1));
        continue;
      }
      log.error({ err }, label);
      return undefined;
    }
  }
}

/** Persist a document create/update to DB. */

export function todayUtcDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Atomically bump a workspace's daily QA/Agent counter.
 *  Quota and usage.alert read this table, so it must survive restarts. */
