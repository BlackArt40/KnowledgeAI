// ---------------------------------------------------------------------------
// P8 · Email verification (register -> verify link -> verified).
//
// Same token hygiene as the password-reset flow (src/lib/auth/password-reset.ts):
// raw token = `${userId}.${secret}` (32 random bytes base64url); only the
// SHA-256 hash of the FULL token plus an expiry is stored on the User row, so
// a DB leak never exposes usable links and lookup stays O(1). Single-use, and
// re-issuing a verification token invalidates any previous one.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { findUserByEmail, getUserById, type User } from "@/lib/auth/store";
import { persistUser } from "@/lib/db/persist";
import { hashToken } from "@/lib/auth/token-hash";

/** Verification links expire after 24 hours. */
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60_000;

/**
 * Issue a verification token for the account with `email`. Returns the RAW
 * token (delivered by email / demo response) or null when the account does
 * not exist or is already verified.
 */
export function issueEmailVerification(email: string): string | null {
  const user = findUserByEmail(email);
  if (!user) return null;
  if (user.emailVerifiedAt) return null; // verified - nothing to verify
  const secret = crypto.randomBytes(32).toString("base64url");
  const token = `${user.id}.${secret}`;
  user.verificationTokenHash = hashToken(token);
  user.verificationExpires = Date.now() + EMAIL_VERIFY_TTL_MS;
  void persistUser(user);
  return token;
}

export type ConsumeResult = { ok: true; email: string; user: User } | { error: string };
export type VerifyResult = { ok: true; email: string; userId: string } | { error: string };

export const VERIFY_ERROR_INVALID = "验证链接无效";
export const VERIFY_ERROR_EXPIRED = "验证链接已失效，请重新发送";

/**
 * Validate a verification token (shape + hash + expiry) without consuming it.
 * An already-verified account rejects further tokens (they're superseded).
 * Synchronous by design - see consumePasswordReset: verifyEmail must clear
 * the token before its first await so replays can't double-consume.
 */
export function consumeEmailVerification(token: string): ConsumeResult {
  const idx = token.indexOf(".");
  if (idx <= 0) return { error: VERIFY_ERROR_INVALID };
  const user = getUserById(token.slice(0, idx));
  if (!user || !user.verificationTokenHash || !user.verificationExpires) {
    return { error: VERIFY_ERROR_INVALID };
  }
  if (user.emailVerifiedAt) return { error: VERIFY_ERROR_INVALID };
  if (Date.now() > user.verificationExpires) {
    return { error: VERIFY_ERROR_EXPIRED };
  }
  if (user.verificationTokenHash !== hashToken(token)) {
    return { error: VERIFY_ERROR_INVALID };
  }
  return { ok: true, email: user.email, user };
}

/** Consume a valid token and mark the inbox verified (single-use). */
export function verifyEmail(token: string): VerifyResult {
  const result = consumeEmailVerification(token);
  if ("error" in result) return result;
  const user = result.user;
  user.emailVerifiedAt = Date.now();
  user.verificationTokenHash = undefined;
  user.verificationExpires = undefined;
  void persistUser(user);
  return { ok: true, email: user.email, userId: user.id };
}
