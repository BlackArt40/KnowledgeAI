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


import { getDb, isDbEnabled } from "../prisma";

import { log } from "@/lib/obs/log";

/**
 * Best-effort persistence helper. Deletes are idempotent, so a P2025 ("row not
 * found") is expected and ignored; every other failure is logged. Previously
 * these paths used `.catch((err) => bestEffort(err))`, which silently diverged memory from DB.
 */
import { bestEffort } from "./core";

export async function persistApiKey(key: {
  id: string;
  userId: string;
  name: string;
  secret: string;
  prefix: string;
  scopes: string[];
  status: string;
  calls: number;
  lastUsed: number | null;
  expiresAt: number | null;
  createdAt: number;
}): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    const data = {
      name: key.name,
      // P2: `sha256$...` for new keys; legacy rows may still hold AES
      // ciphertext or plaintext and keep validating via the old path.
      keyHash: key.secret,
      prefix: key.prefix,
      scopes: key.scopes,
      status: key.status,
      calls: key.calls,
      lastUsed: key.lastUsed ? new Date(key.lastUsed) : null,
      expiresAt: key.expiresAt ? new Date(key.expiresAt) : null,
    };
    await db.apiKey.upsert({
      where: { id: key.id },
      update: data,
      create: { id: key.id, userId: key.userId, ...data, createdAt: new Date(key.createdAt) },
    });
  } catch (err) {
    log.error({ err }, "[db] persistApiKey error");
  }
}

/** Delete an API key from DB. */


export async function deleteApiKeyFromDb(keyId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.apiKey.delete({ where: { id: keyId } }).catch((err) => bestEffort(err));
  } catch (err) {
    log.error({ err }, "[db] deleteApiKeyFromDb error");
  }
}

// ── Chat: Conversations + Messages ───────────────────────────────────────

/** Persist a conversation (with messages) to DB. */

