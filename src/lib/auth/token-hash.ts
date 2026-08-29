// ---------------------------------------------------------------------------
// P8 · Shared token hashing for the auth token flows (password reset, email
// verification). Raw tokens are `${userId}.${secret}` strings; only their
// SHA-256 hash is ever persisted (see password-reset.ts / email-verify.ts).
// ---------------------------------------------------------------------------

import crypto from "crypto";

/** SHA-256 hex digest of a raw auth token - the only form we store. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
