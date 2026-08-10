// ---------------------------------------------------------------------------
// Document share links (P4-2): time-limited public access to a single
// document. Mirrors the Agent report share pattern (src/lib/agent/store.ts
// ShareConfig): expiry / password / view limit, 410/401/403 error codes.
// One active link per document; revoking removes it entirely.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { getDocument } from "./store";

export interface DocShare {
  token: string;
  docId: string;
  createdBy: string;
  createdAt: number;
  expiresAt?: number;   // epoch ms; undefined = never expires
  passwordHash?: string; // SHA-256; undefined = no password
  maxViews?: number;    // undefined = unlimited
  views: number;
}

type Store = Map<string, DocShare>;
const g = globalThis as unknown as { __KAI_DOC_SHARE_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_DOC_SHARE_STORE__) g.__KAI_DOC_SHARE_STORE__ = new Map();
  return g.__KAI_DOC_SHARE_STORE__;
}

function genToken(): string {
  return "sh_" + crypto.randomBytes(12).toString("hex");
}

export function hashSharePassword(pwd: string): string {
  return crypto.createHash("sha256").update(pwd).digest("hex");
}

export function verifySharePassword(pwd: string, hash: string): boolean {
  return hashSharePassword(pwd) === hash;
}

/** Create (or replace) the share link of a document - one per document. */
export function createDocShare(input: {
  docId: string;
  createdBy: string;
  expiresAt?: number;
  password?: string;
  maxViews?: number;
}): DocShare {
  const s = store();
  for (const [token, sh] of s) {
    if (sh.docId === input.docId) s.delete(token); // replace existing
  }
  const share: DocShare = {
    token: genToken(),
    docId: input.docId,
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

export function getDocShare(token: string): DocShare | undefined {
  return store().get(token);
}

export function getDocShareByDoc(docId: string): DocShare | undefined {
  for (const sh of store().values()) {
    if (sh.docId === docId) return sh;
  }
  return undefined;
}

export function revokeDocShare(token: string): boolean {
  return store().delete(token);
}

export function revokeDocShareByDoc(docId: string): boolean {
  const s = store();
  for (const [token, sh] of s) {
    if (sh.docId === docId) {
      s.delete(token);
      return true;
    }
  }
  return false;
}

export type ShareCheckResult =
  | { ok: true; share: DocShare; doc: NonNullable<ReturnType<typeof getDocument>> }
  | { ok: false; status: 401 | 403 | 404 | 410; code: "needPassword" | "expired" | "exhausted" | "notFound" };

/** Validate a share token (public endpoint): not-found / expired / password
 *  / view-limit. Successful checks count the view (like Agent share views). */
export function checkDocShare(token: string, password?: string): ShareCheckResult {
  const share = getDocShare(token);
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
  const doc = getDocument(share.docId);
  if (!doc) return { ok: false, status: 404, code: "notFound" };
  share.views += 1;
  return { ok: true, share, doc };
}
