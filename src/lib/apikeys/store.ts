import type { ApiKey, CallLog, KeyStatus } from "./types";

type Store = { keys: ApiKey[]; logs: CallLog[] };
const g = globalThis as unknown as { __KAI_APIKEY_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_APIKEY_STORE__) {
    g.__KAI_APIKEY_STORE__ = { keys: [], logs: [] };
  }
  return g.__KAI_APIKEY_STORE__;
}

function uid(p: string) {
  return `${p}_${Math.random().toString(36).slice(2, 10)}`;
}
function genSecret() {
  return "kai_sk_" + Array.from({ length: 32 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
  ).join("");
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
  store().keys.unshift(key);
  return key;
}

export function toggleKey(id: string, status: KeyStatus, userId: string): ApiKey | null {
  const k = store().keys.find((k) => k.id === id && k.userId === userId);
  if (k) k.status = status;
  return k ?? null;
}

export function deleteKey(id: string, userId: string): boolean {
  const s = store();
  const idx = s.keys.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return false;
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

/** Validate an API key by its secret. Returns the key if active, or null. */
export function validateApiKey(secret: string): ApiKey | null {
  const k = store().keys.find((k) => k.secret === secret && k.status === "active");
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
