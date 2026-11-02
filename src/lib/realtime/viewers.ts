// ---------------------------------------------------------------------------
// KB co-viewing (P4-1 follow-up): who is looking at this knowledge base now.
//
// The KB event stream already pushes data changes; this adds the *people*
// dimension of "多人同时在线、看同一份数据": everyone with the KB page open is
// tracked, and changes are broadcast as `{ type: "viewers", kbId, viewers }`
// on the same `kb:<id>` channel (so a single SSE connection serves both).
//
// Viewers are tracked per KB with a connection refcount; the route heartbeat
// refreshes lastSeen and stale entries expire after VIEWER_TTL_MS.
// ---------------------------------------------------------------------------

import { publish } from "./bus";
import { createConnectionRegistry } from "./connections";

export const VIEWER_TTL_MS = 90_000;

export interface KbViewer {
  userId: string;
  name: string;
}

interface ViewerMember {
  id: string;
  name: string;
}

function publishViewers(kbId: string): void {
  publish(`kb:${kbId}`, { type: "viewers", kbId, viewers: getKbViewers(kbId) });
}

const registry = createConnectionRegistry<ViewerMember>("kb-viewers", {
  ttlMs: VIEWER_TTL_MS,
  sweepMs: 30_000,
  onChange: publishViewers,
});

/** Register one open KB stream. Returns an idempotent leave handler. */
export function joinKbViewers(kbId: string, userId: string, name: string): () => void {
  return registry.connect(kbId, { id: userId, name });
}

/** Refresh lastSeen (called from the KB stream heartbeat). */
export function touchKbViewers(kbId: string, userId: string): void {
  registry.touch(kbId, userId);
}

/** Members currently viewing a KB (stale entries pruned by TTL). */
export function getKbViewers(kbId: string): KbViewer[] {
  return registry.list(kbId).map(({ member }) => ({ userId: member.id, name: member.name }));
}
