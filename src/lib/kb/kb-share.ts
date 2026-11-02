// ---------------------------------------------------------------------------
// Knowledge-base share links（共享与分发）: one public read-only link per KB,
// with expiry / password / view limit - mirrors the document share pattern
// (./doc-share.ts) and the Agent report share convention (410/401/403/404).
//
// The token itself is the credential: the public route needs no login. Only
// documents WITHOUT a doc-level "private" override are exposed, and their
// content is truncated to a preview - full text stays in the knowledge base.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { getKb, listDocuments } from "./store";
import type { KbDocument, KnowledgeBase } from "./types";
import { hashSharePassword, verifySharePassword } from "@/lib/security/share-password";

/** Content window exposed by the public page (same cap as doc-share). */
export const KB_SHARE_PREVIEW_CHARS = 3000;
/** One-line snippet rendered in the public document list. */
export const KB_SHARE_SNIPPET_CHARS = 160;
/** Hard cap on the document list returned by the public endpoint. */
export const KB_SHARE_MAX_DOCS = 200;

export interface KbShare {
  token: string;
  kbId: string;
  createdBy: string;
  createdAt: number;
  expiresAt?: number; // epoch ms; undefined = never expires
  passwordHash?: string; // PBKDF2+salt (share-password.ts); undefined = no password
  maxViews?: number; // undefined = unlimited
  views: number;
}

type Store = Map<string, KbShare>;
const g = globalThis as unknown as { __KAI_KB_SHARE_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_KB_SHARE_STORE__) g.__KAI_KB_SHARE_STORE__ = new Map();
  return g.__KAI_KB_SHARE_STORE__;
}

function genToken(): string {
  return "ks_" + crypto.randomBytes(12).toString("hex");
}

/** Public shape - never leaks the password hash. */
export type KbSharePublic = Omit<KbShare, "passwordHash">;

export function sanitizeKbShare(share: KbShare): KbSharePublic {
  const { passwordHash: _hash, ...safe } = share;
  return safe;
}

/** Create (or replace) the share link of a KB - one active link per KB. */
export function createKbShare(input: {
  kbId: string;
  createdBy: string;
  expiresAt?: number;
  password?: string;
  maxViews?: number;
}): KbShare {
  const s = store();
  for (const [token, sh] of s) {
    if (sh.kbId === input.kbId) s.delete(token); // replace existing
  }
  const share: KbShare = {
    token: genToken(),
    kbId: input.kbId,
    createdBy: input.createdBy,
    createdAt: Date.now(),
    expiresAt: input.expiresAt,
    passwordHash: input.password ? hashSharePassword(input.password) : undefined,
    maxViews: input.maxViews,
    views: 0,
  };
  s.set(share.token, share);
  return share;
}

export function getKbShare(token: string): KbShare | undefined {
  return store().get(token);
}

export function getKbShareByKb(kbId: string): KbShare | undefined {
  for (const sh of store().values()) {
    if (sh.kbId === kbId) return sh;
  }
  return undefined;
}

export function revokeKbShare(token: string): boolean {
  return store().delete(token);
}

export function revokeKbShareByKb(kbId: string): boolean {
  const s = store();
  for (const [token, sh] of s) {
    if (sh.kbId === kbId) {
      s.delete(token);
      return true;
    }
  }
  return false;
}

export type KbShareErrorCode = "needPassword" | "expired" | "exhausted" | "notFound";

export type KbShareCheckResult =
  | {
      ok: true;
      share: KbShare;
      kb: KnowledgeBase;
      /** Docs visible through the link (doc-level "private" already removed). */
      docs: KbDocument[];
    }
  | { ok: false; status: 401 | 403 | 404 | 410; code: KbShareErrorCode };

/** Documents a public visitor may see: doc-level "private" stays hidden. */
function publicDocs(kbId: string): KbDocument[] {
  return listDocuments(kbId)
    .filter((d) => d.access !== "private")
    .slice(0, KB_SHARE_MAX_DOCS);
}

/** Validate a KB share token (public endpoint): not-found / expired / password
 *  / view-limit. `countView` is true only for a page load (list request), so
 *  opening individual document previews does not burn the view budget. */
export function checkKbShare(
  token: string,
  password?: string,
  opts: { countView?: boolean } = {}
): KbShareCheckResult {
  const share = getKbShare(token);
  if (!share) return { ok: false, status: 404, code: "notFound" };
  if (share.expiresAt && Date.now() > share.expiresAt) {
    return { ok: false, status: 410, code: "expired" };
  }
  if (share.passwordHash) {
    if (!password || !verifySharePassword(password, share.passwordHash)) {
      return { ok: false, status: 401, code: "needPassword" };
    }
  }
  if (share.maxViews !== undefined && share.views >= share.maxViews) {
    return { ok: false, status: 403, code: "exhausted" };
  }
  const kb = getKb(share.kbId);
  if (!kb) return { ok: false, status: 404, code: "notFound" };
  if (opts.countView !== false) share.views += 1;
  return { ok: true, share, kb, docs: publicDocs(kb.id) };
}
