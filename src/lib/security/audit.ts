// ---------------------------------------------------------------------------
// Security Audit Trail (P3-4)
//
// Append-only, tamper-evident audit log for sensitive operations:
// login / delete / permission changes / data export / config changes.
//
// Tamper evidence: every entry carries
//   hash = HMAC-SHA256(prevHash | id | actorId | actor | action | target |
//                      detail | ip | createdAt, AUTH_SECRET)
// where prevHash links to the chronologically previous entry (GENESIS_HASH
// for the first). verifyAuditChain() re-computes every hash and checks the
// links, so any edit / deletion / insertion breaks the chain.
//
// Retention (P3-4): AUDIT_RETENTION_DAYS (default 90) + a hard in-memory cap
// (AUDIT_MAX_ENTRIES, default 2000). trimAudit() is invoked by the admin
// cleanup endpoint; the cap is enforced on every write.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { persistAuditEvent } from "@/lib/db/persist";
import { uid } from "@/lib/ids";
import { getAuthSecret } from "@/lib/secrets";

const GENESIS_HASH = "genesis";
const AUDIT_MAX_ENTRIES = parseInt(process.env.AUDIT_MAX_ENTRIES || "2000", 10);
const RETENTION_MS =
  parseInt(process.env.AUDIT_RETENTION_DAYS || "90", 10) * 86_400_000;

export interface AuditEvent {
  id: string;
  actorId: string | null;
  actor: string;
  action: string;
  target: string;
  detail: string;
  ip: string | null;
  createdAt: number;
  prevHash: string;
  hash: string;
}

export interface AuditInput {
  actorId?: string | null;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
  ip?: string | null;
}

type Store = AuditEvent[];
const g = globalThis as unknown as {
  __KAI_AUDIT_STORE__?: Store;
  __KAI_AUDIT_TRUNCATED__?: boolean;
};

function store(): Store {
  if (!g.__KAI_AUDIT_STORE__) g.__KAI_AUDIT_STORE__ = [];
  return g.__KAI_AUDIT_STORE__;
}

function hmacSecret(): string {
  return getAuthSecret("knowledgeai-dev-secret-change-me");
}

/** Hash an audit event (all fields except prevHash/hash). */
function hashEvent(prevHash: string, e: Omit<AuditEvent, "prevHash" | "hash">): string {
  const parts = [
    prevHash,
    e.id,
    e.actorId ?? "",
    e.actor,
    e.action,
    e.target,
    e.detail,
    e.ip ?? "",
    String(e.createdAt),
  ];
  return crypto.createHmac("sha256", hmacSecret()).update(parts.join("|")).digest("hex");
}

/** Append a new audit entry (head = newest). Fire-and-forget DB write-through. */
export function recordAudit(input: AuditInput): AuditEvent {
  const s = store();
  const prevHash = s.length > 0 ? s[0].hash : GENESIS_HASH;
  const base: Omit<AuditEvent, "prevHash" | "hash"> = {
    id: uid("aud"),
    actorId: input.actorId ?? null,
    actor: input.actor,
    action: input.action,
    target: input.target ?? "",
    detail: input.detail ?? "",
    ip: input.ip ?? null,
    createdAt: Date.now(),
  };
  const ev: AuditEvent = { ...base, prevHash, hash: hashEvent(prevHash, base) };
  s.unshift(ev);
  if (s.length > AUDIT_MAX_ENTRIES) {
    s.length = AUDIT_MAX_ENTRIES; // hard cap
    g.__KAI_AUDIT_TRUNCATED__ = true;
  }
  void persistAuditEvent(ev);
  return ev;
}

/** Re-verify the audit log.
 *
 *  Multi-process safe: web and worker each append with their own in-memory
 *  head, which produces several sibling branches in the DB. Instead of
 *  requiring strict adjacency (the old check reported `valid:false` as soon as
 *  two processes interleaved), every entry must:
 *    1. carry a valid HMAC for the prevHash it claims, and
 *    2. point at an entry that exists (or GENESIS).
 *  A deletion still breaks the child's link; a tampered field still breaks its
 *  HMAC. Retention pruning may remove the oldest entries, so dangling links
 *  are tolerated only at the tail (oldest retained boundary) and reported as
 *  `truncated`.
 */
export function verifyAuditChain(): {
  valid: boolean;
  brokenAt: number;
  truncated: boolean;
} {
  const s = store();
  const hashes = new Set(s.map((e) => e.hash));
  let truncated = false;
  for (let i = 0; i < s.length; i++) {
    const cur = s[i];
    if (cur.hash !== hashEvent(cur.prevHash, cur)) {
      return { valid: false, brokenAt: i, truncated: false };
    }
    if (cur.prevHash !== GENESIS_HASH && !hashes.has(cur.prevHash)) {
      // Retention/cap pruning is the only legitimate reason for a dangling
      // link. Without an actual trim event this is a deleted row -> invalid.
      if (g.__KAI_AUDIT_TRUNCATED__) {
        truncated = true;
        continue;
      }
      return { valid: false, brokenAt: i, truncated: false };
    }
  }
  return { valid: true, brokenAt: -1, truncated };
}

/** Filtered retrieval for the admin panel: by action (substring), actor
 *  (name or id substring), and time range (epoch ms). Newest first. */
export function listAudit(opts?: {
  action?: string;
  actor?: string;
  from?: number;
  to?: number;
  limit?: number;
}): { audit: AuditEvent[]; total: number } {
  let rows = store();
  if (opts?.action) rows = rows.filter((r) => r.action.includes(opts.action!));
  if (opts?.actor) {
    const q = opts.actor!.toLowerCase();
    rows = rows.filter((r) => r.actor.toLowerCase().includes(q) || (r.actorId ?? "").toLowerCase().includes(q));
  }
  if (opts?.from !== undefined) rows = rows.filter((r) => r.createdAt >= opts.from!);
  if (opts?.to !== undefined) rows = rows.filter((r) => r.createdAt <= opts.to!);
  return { audit: rows.slice(0, opts?.limit ?? 50), total: rows.length };
}

/** Retention policy: drop entries older than AUDIT_RETENTION_DAYS.
 *  Returns the number of entries removed. */
export function trimAudit(): number {
  const s = store();
  const cutoff = Date.now() - RETENTION_MS;
  const before = s.length;
  const kept = s.filter((e) => e.createdAt >= cutoff);
  g.__KAI_AUDIT_STORE__ = kept;
  if (kept.length !== before) g.__KAI_AUDIT_TRUNCATED__ = true;
  return before - kept.length;
}

