import type { ApiKey, CallLog, KeyStatus } from "./types";
import { persistApiKey, deleteApiKeyFromDb } from "@/lib/db/persist";
import { encryptToString, decryptFromString, isEncrypted } from "@/lib/crypto";
import { uid, genSecret } from "@/lib/ids";

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

/** Validate an API key by its secret. Returns the key if active, or null. */
export function validateApiKey(secret: string): ApiKey | null {
  const k = store().keys.find((k) => storedSecretOf(k) === secret && k.status === "active");
  return k ?? null;
}

/** Record a real API call and increment the key's counter. */
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
