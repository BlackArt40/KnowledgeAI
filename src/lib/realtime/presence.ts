// ---------------------------------------------------------------------------
// Presence (P4-1): team member online/offline state.
//
// A user is ONLINE while at least one of their SSE presence streams is open.
// Multiple tabs share one entry (connection refcount), so closing one tab does
// not mark the user offline. The route refreshes lastSeen on every heartbeat;
// entries without a heartbeat for PRESENCE_TTL_MS are dropped (half-open
// connections where the abort signal never arrives). Every actual change
// broadcasts the full online list on the `presence` channel.
// ---------------------------------------------------------------------------

import { publish } from "./bus";
import { createConnectionRegistry } from "./connections";

export const PRESENCE_CHANNEL = "presence";
export const PRESENCE_TTL_MS = 60_000;

export interface PresenceUser {
  userId: string;
  name: string;
  email: string;
  lastSeen: number;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
}

function publishPresence(): void {
  publish(PRESENCE_CHANNEL, { type: "presence", online: getOnlineUsers() });
}

const registry = createConnectionRegistry<TeamMember>("presence", {
  ttlMs: PRESENCE_TTL_MS,
  sweepMs: 20_000,
  onChange: publishPresence,
});

/** Mark a presence stream as open. Returns the matching disconnect handler. */
export function connectPresence(userId: string, name: string, email: string): () => void {
  return registry.connect("team", { id: userId, name, email });
}

/** Explicit teardown when the route did not keep the connect handler. */
export function disconnectPresence(userId: string): void {
  registry.disconnect("team", userId);
}

/** Refresh lastSeen (called from the route heartbeat while the stream is open). */
export function touchPresence(userId: string): void {
  registry.touch("team", userId);
}

/** Currently online users (stale entries pruned by TTL). */
export function getOnlineUsers(): PresenceUser[] {
  return registry.list("team").map(({ member, lastSeen }) => ({
    userId: member.id,
    name: member.name,
    email: member.email,
    lastSeen,
  }));
}

/** Whether a given user id is currently online. */
export function isOnline(userId: string): boolean {
  return getOnlineUsers().some((u) => u.userId === userId);
}
