import crypto from "crypto";
import type { ApiKey, CallLog, KeyStatus } from "./types";
import { persistApiKey, deleteApiKeyFromDb } from "@/lib/db/persist";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { encryptToString, decryptFromString, isEncrypted } from "@/lib/crypto";
import { uid, genSecret } from "@/lib/ids";
import { log } from "@/lib/obs/log";

type Store = { keys: ApiKey[]; logs: CallLog[] };
const g = globalThis as unknown as { __KAI_APIKEY_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_APIKEY_STORE__) {
    g.__KAI_APIKEY_STORE__ = { keys: [], logs: [] };
  }
  return g.__KAI_APIKEY_STORE__;
}

function mask(s: string) {
  return s.slice(0, 12) + "…" + s.slice(-4);
}

// ── CRUD (per-user) ──────────────────────────────────────────────────────

export function listKeys(userId: string): ApiKey[] {
  return store().keys
    .filter((k) => k.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function createKey(name: string, scopes: string[], userId: string): ApiKey {
  const secret = genSecret();
  const key: ApiKey = {
    userId,
    id: uid("key"),
    name: name || "未命名密钥",
    prefix: mask(secret),
    secret,
    scopes,
    status: "active",
    createdAt: Date.now(),
    lastUsed: null,
    calls: 0,
  };
  // P3-4: store the secret ENCRYPTED (in-memory + DB write-through via
  // persistApiKey). The plaintext is only returned once, in this response.
  const stored: ApiKey = { ...key, secret: encryptToString(secret) };
  store().keys.unshift(stored);
  void persistApiKey(stored);
  return key;
}

export function toggleKey(id: string, status: KeyStatus, userId: string): ApiKey | null {
  const k = store().keys.find((k) => k.id === id && k.userId === userId);
  if (k) { k.status = status; void persistApiKey(k); }
  return k ?? null;
}

export function deleteKey(id: string, userId: string): boolean {
  const s = store();
  const idx = s.keys.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return false;
  void deleteApiKeyFromDb(id);
  s.keys.splice(idx, 1);
  // Also remove logs for this key
  s.logs = s.logs.filter((l) => l.keyId !== id);
  return true;
}

export function listLogs(userId: string): CallLog[] {
  const s = store();
  const keyIds = new Set(s.keys.filter((k) => k.userId === userId).map((k) => k.id));
  return s.logs
    .filter((l) => keyIds.has(l.keyId))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 100);
}

// ── API key validation + call logging ────────────────────────────────────

/** Resolve a key's stored secret to plaintext. Encrypted values decrypt with
 *  the current AUTH_SECRET; legacy plaintext (pre-P3-4) is used as-is; a
 *  failed decryption (key rotated / data corrupt) yields "" -> invalid. */
function storedSecretOf(k: ApiKey): string {
  if (!isEncrypted(k.secret)) return k.secret;
  try { return decryptFromString(k.secret); } catch { return ""; }
}

/** Constant-time string comparison (F10). Returns false on a length mismatch
 *  (the only thing a shorter/longer value can leak is its own length). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf-8");
  const bb = Buffer.from(b, "utf-8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Validate an API key by its secret. Returns the key if active, or null.
 *
 *  NOTE (F5): this sync variant reads ONLY the in-process store - it is the
 *  fast path and the best-effort lookup used by the proxy's rate-limit
 *  tiering. The authoritative check for API auth is validateApiKeyShared(),
 *  which adds a throttled DB fallback so keys created on other instances are
 *  honored without a restart. */
export function validateApiKey(secret: string): ApiKey | null {
  // F10: `storedSecretOf(k) === secret` short-circuited on the first differing
  // character, leaking a prefix oracle for a long-lived credential.
  const k = store().keys.find((k) => k.status === "active" && safeEqual(storedSecretOf(k), secret));
  return k ?? null;
}

// ── F5: shared read path (multi-instance API-key validation) ──────────────
//
// The in-memory store is hydrated from the DB at boot, but a key created on
// instance A afterwards was invisible to instance B (401 for a valid key).
// validateApiKeyShared() keeps the memory map as the fast path and, on a
// miss, sweeps the DB write-through target to pick up out-of-instance keys.
// The sweep is throttled + de-duplicated so garbage bearer tokens can't turn
// the miss path into a DB-amplification vector: a newly created key becomes
// visible on other instances within KEY_REFRESH_THROTTLE_MS.

const KEY_REFRESH_THROTTLE_MS = 3000;
let lastApiKeySweepAt = 0;
let inflightApiKeySweep: Promise<void> | null = null;

/** DB row shape of ApiKey (keyHash holds the AES-GCM ciphertext of the secret). */
export interface ApiKeyRow {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  prefix: string;
  scopes: string[];
  status: string;
  calls: number;
  lastUsed: Date | null;
  createdAt: Date;
}

/** Merge a DB row into the in-memory store (skip when already present).
 *  Shared by the boot hydration (db/hydrate.ts) and the sweep below so both
 *  map rows identically (secret = keyHash ciphertext; decrypted on compare). */
export function mergeApiKeyRow(r: ApiKeyRow): void {
  const s = store();
  if (s.keys.some((k) => k.id === r.id)) return;
  s.keys.push({
    id: r.id,
    userId: r.userId,
    name: r.name,
    secret: r.keyHash,
    prefix: r.prefix,
    scopes: r.scopes,
    status: r.status as KeyStatus,
    calls: r.calls,
    lastUsed: r.lastUsed ? r.lastUsed.getTime() : null,
    createdAt: r.createdAt.getTime(),
  });
}

async function sweepApiKeysFromDb(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const rows = await (db as unknown as {
    apiKey: { findMany: (o?: unknown) => Promise<unknown[]> };
  }).apiKey.findMany({ orderBy: { createdAt: "desc" } });
  for (const r of rows as unknown as ApiKeyRow[]) mergeApiKeyRow(r);
}

/** Validate an API key, falling back to the DB when the memory miss could be
 *  an out-of-instance key. See the comment block above for the throttle. */
export async function validateApiKeyShared(secret: string): Promise<ApiKey | null> {
  const fast = validateApiKey(secret);
  if (fast) return fast;
  if (!isDbEnabled()) return null;

  try {
    if (inflightApiKeySweep) {
      // Another request is already sweeping - ride along instead of stacking.
      await inflightApiKeySweep;
    } else if (Date.now() - lastApiKeySweepAt >= KEY_REFRESH_THROTTLE_MS) {
      lastApiKeySweepAt = Date.now();
      inflightApiKeySweep = sweepApiKeysFromDb()
        .catch((err) => {
          // Keep the memory-only read path on DB trouble (fail closed for the
          // unknown key: it stays invalid until the next successful sweep).
          log.error({ err }, "[apikeys] DB sweep failed - key stays invalid this round");
        })
        .finally(() => {
          inflightApiKeySweep = null;
        });
      await inflightApiKeySweep;
    }
  } catch {
    /* sweep never rejects (caught above) */
  }

  // Re-check: the sweep may have pulled the key from the DB into memory.
  return validateApiKey(secret);
}

/** Test-only: reset the sweep throttle between cases. */
export function __resetApiKeySweepForTest(): void {
  lastApiKeySweepAt = 0;
  inflightApiKeySweep = null;
}

/** Record a real API call and increment the key's counter.
 *  M-6: counters were memory-only - a restart rolled every key back to 0
 *  calls. Now they are written through to the DB throttled (at most once per
 *  interval or every N calls) so hot keys don't hammer the DB on every call. */
export function logCall(
  keyId: string,
  endpoint: string,
  method: string,
  status: number,
  latencyMs: number
): void {
  const s = store();
  const k = s.keys.find((k) => k.id === keyId);
  if (k) {
    k.calls++;
    k.lastUsed = Date.now();
    maybePersistKey(k);
  }
  s.logs.unshift({
    id: uid("log"),
    keyId,
    endpoint,
    method,
    status,
    ts: Date.now(),
    latencyMs,
  });
  // Keep max 500 logs total
  if (s.logs.length > 500) s.logs.length = 500;
}

// ── M-6: throttled write-through for call counters ────────────────────────

const PERSIST_INTERVAL_MS = 30_000;
const PERSIST_EVERY_N = 50;
const persistState = new Map<string, { lastPersistAt: number; countSincePersist: number }>();

function maybePersistKey(k: ApiKey): void {
  const st = persistState.get(k.id) ?? { lastPersistAt: 0, countSincePersist: 0 };
  st.countSincePersist++;
  const now = Date.now();
  if (st.countSincePersist >= PERSIST_EVERY_N || now - st.lastPersistAt >= PERSIST_INTERVAL_MS) {
    st.lastPersistAt = now;
    st.countSincePersist = 0;
    void persistApiKey(k);
  }
  persistState.set(k.id, st);
}
