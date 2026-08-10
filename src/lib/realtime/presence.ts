// ---------------------------------------------------------------------------
// Presence (P4-1): team member online/offline state.
//
// A user is ONLINE while their SSE presence stream is open; the stream route
// calls heartbeat() on connect and markOffline() on disconnect. Entries whose
// heartbeat is older than PRESENCE_TTL_MS are lazily dropped (proxy drop-outs
// without an abort signal). Every change broadcasts the full online list on
// the `presence` channel.
// ---------------------------------------------------------------------------

import { publish } from "./bus";

export const PRESENCE_CHANNEL = "presence";
const PRESENCE_TTL_MS = 60_000;

export interface PresenceUser {
  userId: string;
  name: string;
  email: string;
  lastSeen: number;
}

type Store = Map<string, PresenceUser>;
const g = globalThis as unknown as { __KAI_PRESENCE_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_PRESENCE_STORE__) g.__KAI_PRESENCE_STORE__ = new Map();
  return g.__KAI_PRESENCE_STORE__;
}

function publishPresence(): void {
  publish(PRESENCE_CHANNEL, { type: "presence", online: getOnlineUsers() });
}

/** Mark a user online (SSE connection established). Broadcasts the new list. */
export function heartbeat(userId: string, name: string, email: string): void {
  store().set(userId, { userId, name, email, lastSeen: Date.now() });
  publishPresence();
}

/** Mark a user offline (SSE connection closed). */
export function markOffline(userId: string): void {
  store().delete(userId);
  publishPresence();
}

/** Currently online users (heartbeats within the TTL, lazily pruned). */
export function getOnlineUsers(): PresenceUser[] {
  const s = store();
  const now = Date.now();
  for (const [id, u] of s) {
    if (now - u.lastSeen > PRESENCE_TTL_MS) s.delete(id);
  }
  return [...s.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

/** Whether a given user id is currently online. */
export function isOnline(userId: string): boolean {
  return getOnlineUsers().some((u) => u.userId === userId);
}
