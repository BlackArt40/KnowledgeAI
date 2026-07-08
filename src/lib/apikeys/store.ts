import type { ApiKey, CallLog, KeyStatus } from "./types";

type Store = { keys: ApiKey[]; logs: CallLog[]; seeded: boolean };
const g = globalThis as unknown as { __KAI_APIKEY_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_APIKEY_STORE__) {
    g.__KAI_APIKEY_STORE__ = { keys: [], logs: [], seeded: false };
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

const NOW = Date.now();
const DAY = 86400000;

function seed() {
  const s = store();
  if (s.seeded) return;
  s.seeded = true;
  const k1: ApiKey = {
    id: "key_prod", name: "生产环境密钥",
    prefix: mask("kai_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"),
    secret: "kai_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    scopes: ["kb:read", "chat:read", "agent:run"],
    status: "active", createdAt: NOW - 60 * DAY, lastUsed: NOW - 3600_000, calls: 18420,
  };
  const k2: ApiKey = {
    id: "key_ci", name: "CI/CD 同步",
    prefix: mask("kai_sk_z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4"),
    secret: "kai_sk_z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4",
    scopes: ["kb:read", "kb:write"],
    status: "active", createdAt: NOW - 20 * DAY, lastUsed: NOW - 2 * DAY, calls: 342,
  };
  const k3: ApiKey = {
    id: "key_old", name: "旧版 webhook（已弃用）",
    prefix: mask("kai_sk_q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6"),
    secret: "kai_sk_q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6",
    scopes: ["chat:read"],
    status: "disabled", createdAt: NOW - 120 * DAY, lastUsed: NOW - 90 * DAY, calls: 89,
  };
  s.keys = [k1, k2, k3];
  const endpoints = ["/api/chat", "/api/knowledge-base", "/api/agent/run", "/api/knowledge-base/[id]/upload"];
  const methods = ["POST", "GET", "POST", "POST"];
  const logs: CallLog[] = [];
  for (let i = 0; i < 24; i++) {
    const ki = i % 2;
    const ei = i % endpoints.length;
    logs.push({
      id: uid("log"), keyId: s.keys[ki].id,
      endpoint: endpoints[ei], method: methods[ei],
      status: i % 9 === 0 ? 429 : i % 13 === 0 ? 500 : 200,
      ts: NOW - i * 1800_000 - Math.floor(Math.random() * 600_000),
      latencyMs: Math.round(80 + Math.random() * 400),
    });
  }
  s.logs = logs;
}

export function listKeys(): ApiKey[] {
  seed();
  return [...store().keys].sort((a, b) => b.createdAt - a.createdAt);
}

export function createKey(name: string, scopes: string[]): ApiKey {
  seed();
  const secret = genSecret();
  const key: ApiKey = {
    id: uid("key"), name: name || "未命名密钥",
    prefix: mask(secret), secret,
    scopes, status: "active",
    createdAt: Date.now(), lastUsed: null, calls: 0,
  };
  store().keys.unshift(key);
  return key;
}

export function toggleKey(id: string, status: KeyStatus): ApiKey | null {
  seed();
  const k = store().keys.find((k) => k.id === id);
  if (k) k.status = status;
  return k ?? null;
}

export function deleteKey(id: string): boolean {
  seed();
  const s = store();
  const idx = s.keys.findIndex((k) => k.id === id);
  if (idx < 0) return false;
  s.keys.splice(idx, 1);
  return true;
}

export function listLogs(keyId?: string): CallLog[] {
  seed();
  const logs = [...store().logs].sort((a, b) => b.ts - a.ts);
  return keyId ? logs.filter((l) => l.keyId === keyId) : logs;
}
