// ---------------------------------------------------------------------------
// Connection registry shared by the realtime collaboration features.
//
// Both presence ("team online members") and KB co-viewing ("who is looking at
// this knowledge base") need the same semantics, so they share one registry:
//   - a member is online while at least one SSE stream is open (reference
//     counted, so closing one of several tabs does not mark them offline);
//   - lastSeen is refreshed by the route heartbeat and entries older than the
//     TTL are dropped (covers half-open connections where the abort signal is
//     never delivered);
//   - every change in the *visible* member list calls onChange(group), which
//     the caller uses to broadcast a full snapshot on its own channel.
//
// State lives on globalThis so dev HMR does not orphan connected streams.
// Single-instance only; see bus.ts for the multi-instance caveat.
// ---------------------------------------------------------------------------

export interface ConnectionMember {
  id: string;
  name: string;
}

export interface RegistryEntry<M extends ConnectionMember> {
  member: M;
  lastSeen: number;
}

interface Entry<M extends ConnectionMember> {
  member: M;
  connections: number;
  lastSeen: number;
}

interface RegistryState {
  groups: Map<string, Map<string, Entry<ConnectionMember>>>;
  sweep?: ReturnType<typeof setInterval>;
}

export interface ConnectionRegistry<M extends ConnectionMember> {
  /** Register one open stream. Returns an idempotent disconnect function. */
  connect(group: string, member: M): () => void;
  /** Force-disconnect one stream (route teardown when no handle was kept). */
  disconnect(group: string, memberId: string): void;
  /** Refresh lastSeen (called from the route heartbeat). */
  touch(group: string, memberId: string): void;
  /** Current entries of a group, pruned by TTL. */
  list(group: string): RegistryEntry<M>[];
}

const g = globalThis as unknown as {
  __KAI_REALTIME_REGISTRIES__?: Map<string, RegistryState>;
};

function stateFor(name: string): RegistryState {
  if (!g.__KAI_REALTIME_REGISTRIES__) g.__KAI_REALTIME_REGISTRIES__ = new Map();
  let state = g.__KAI_REALTIME_REGISTRIES__.get(name);
  if (!state) {
    state = { groups: new Map() };
    g.__KAI_REALTIME_REGISTRIES__.set(name, state);
  }
  return state;
}

function prune(entries: Map<string, Entry<ConnectionMember>>, ttlMs: number, now: number): boolean {
  let changed = false;
  for (const [id, entry] of entries) {
    if (now - entry.lastSeen > ttlMs) {
      entries.delete(id);
      changed = true;
    }
  }
  return changed;
}

export function createConnectionRegistry<M extends ConnectionMember>(
  name: string,
  opts: {
    ttlMs: number;
    /** Sweep interval for pruning silent deaths; defaults to ttlMs / 3. */
    sweepMs?: number;
    onChange: (group: string) => void;
  }
): ConnectionRegistry<M> {
  const state = stateFor(name);
  const groups = state.groups as unknown as Map<string, Map<string, Entry<M>>>;
  const ttlMs = opts.ttlMs;

  const entriesOf = (group: string): Map<string, Entry<M>> | undefined => groups.get(group);

  function connect(group: string, member: M): () => void {
    let entries = entriesOf(group);
    if (!entries) {
      entries = new Map();
      groups.set(group, entries);
    }
    const now = Date.now();
    const existing = entries.get(member.id);
    if (existing) {
      // Second tab: keep the entry, refresh the display name, bump the count.
      existing.member = member;
      existing.connections += 1;
      existing.lastSeen = now;
    } else {
      entries.set(member.id, { member, connections: 1, lastSeen: now });
    }
    opts.onChange(group);

    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      disconnect(group, member.id);
    };
  }

  function disconnect(group: string, memberId: string): void {
    const entries = entriesOf(group);
    const entry = entries?.get(memberId);
    if (!entries || !entry) return;
    entry.connections -= 1;
    if (entry.connections <= 0) entries.delete(memberId);
    if (entries.size === 0) groups.delete(group);
    opts.onChange(group);
  }

  function touch(group: string, memberId: string): void {
    const entry = entriesOf(group)?.get(memberId);
    if (entry) entry.lastSeen = Date.now();
  }

  function list(group: string): RegistryEntry<M>[] {
    const entries = entriesOf(group);
    if (!entries) return [];
    prune(entries as Map<string, Entry<ConnectionMember>>, ttlMs, Date.now());
    if (entries.size === 0) {
      groups.delete(group);
      return [];
    }
    return [...entries.values()]
      .map((entry) => ({ member: entry.member, lastSeen: entry.lastSeen }))
      .sort((a, b) => a.member.name.localeCompare(b.member.name, "zh"));
  }

  // One sweep per registry per process. It republishes after pruning so other
  // clients don't keep showing a half-open connection as online forever.
  if (!state.sweep) {
    const sweepMs = opts.sweepMs ?? Math.max(5_000, Math.floor(ttlMs / 3));
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [group, entries] of groups) {
        const changed = prune(entries as Map<string, Entry<ConnectionMember>>, ttlMs, now);
        if (entries.size === 0) groups.delete(group);
        if (changed) opts.onChange(group);
      }
    }, sweepMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    state.sweep = timer;
  }

  return { connect, disconnect, touch, list };
}
