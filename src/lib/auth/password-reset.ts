// ---------------------------------------------------------------------------
// P8 · Password reset (forgot-password flow).
//
// Token design: raw token = `${userId}.${secret}` where secret is 32 random
// bytes (base64url, 43 chars). We persist ONLY the SHA-256 hash of the FULL
// token plus an expiry on the User row, so:
//   - a DB leak never exposes usable reset links (hash only),
//   - lookup is O(1) via the userId prefix (no full-store scan),
//   - the token is single-use (cleared on successful reset).
//
// Flow: POST /api/auth/forgot-password  -> issuePasswordReset(email) returns
// the raw token (delivered by email / demo response), the route audits the
// request. POST /api/auth/reset-password  -> resetPassword(token, newPassword)
// verifies hash + expiry, rehashes the password, clears the token, revokes
// ALL of the user's sessions (old JWTs blacklisted via their jti) and clears
// the login lockout - the user must sign in again with the new password.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { findUserByEmail, getUserById, clearLockout, type User } from "@/lib/auth/store";
import { hashPassword } from "@/lib/auth/session";
import { persistUser } from "@/lib/db/persist";
import { getSecurity, revokeSession } from "@/lib/security/store";
import { hashToken } from "@/lib/auth/token-hash";

/** Reset links expire after 30 minutes. */
export const PASSWORD_RESET_TTL_MS = 30 * 60_000;

/**
 * Issue a reset token for the account with `email`. Returns the RAW token
 * (to deliver to the owner) or null when no such account exists - callers
 * must respond identically either way to avoid user enumeration.
 */
export function issuePasswordReset(email: string): string | null {
  const user = findUserByEmail(email);
  if (!user) return null;
  // Invalidate any previous reset token (single active reset per account).
  const secret = crypto.randomBytes(32).toString("base64url");
  const token = `${user.id}.${secret}`;
  user.passwordResetTokenHash = hashToken(token);
  user.passwordResetExpires = Date.now() + PASSWORD_RESET_TTL_MS;
  void persistUser(user);
  return token;
}

export type ResetResult =
  | { user: User }
  | { error: string };

export const RESET_ERROR_INVALID = "重置链接无效";
export const RESET_ERROR_EXPIRED = "重置链接已失效，请重新申请";

/**
 * Validate a reset token (shape + hash + expiry) without consuming it.
 * Synchronous by design: resetPassword must be able to clear the token
 * BEFORE its first await, so a concurrent replay of the same token is
 * rejected instead of racing through (single-threaded JS makes the
 * check-then-clear atomic when no await sits in between).
 */
export function consumePasswordReset(token: string): ResetResult {
  const idx = token.indexOf(".");
  if (idx <= 0) return { error: RESET_ERROR_INVALID };
  const user = getUserById(token.slice(0, idx));
  if (!user || !user.passwordResetTokenHash || !user.passwordResetExpires) {
    return { error: RESET_ERROR_INVALID };
  }
  if (Date.now() > user.passwordResetExpires) {
    return { error: RESET_ERROR_EXPIRED };
  }
  if (user.passwordResetTokenHash !== hashToken(token)) {
    return { error: RESET_ERROR_INVALID };
  }
  return { user };
}

/**
 * Consume a valid reset token and set the new password. On success:
 * password rehashed (PBKDF2), token cleared, every session revoked (the
 * session id doubles as the JWT's jti, so old tokens are blacklisted
 * immediately) and any login lockout lifted.
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<{ ok: true; userId: string; email: string; name: string } | { error: string }> {
  // Validate the password BEFORE consuming so a typo'd short password
  // doesn't burn the single-use link.
  if (newPassword.length < 8) return { error: "新密码至少 8 位" };

  const result = consumePasswordReset(token);
  if ("error" in result) return result;

  const user = result.user;
  // Clear the token synchronously, before the first await below - replays
  // of the same token now fail the hash check instead of double-consuming.
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpires = undefined;
  user.passwordHash = await hashPassword(newPassword);
  void persistUser(user);

  // Forced re-login: blacklist every existing session's jti (including the
  // current one - we can't tell which device is which, so all must go).
  for (const s of getSecurity(user.id).sessions) {
    revokeSession(user.id, s.id);
  }
  clearLockout(user.email);
  return { ok: true, userId: user.id, email: user.email, name: user.name };
}
