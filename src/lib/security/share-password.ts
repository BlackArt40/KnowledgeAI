// ---------------------------------------------------------------------------
// Share-password hashing (L-2) - PBKDF2 with a per-share random salt.
//
// Report share links and document share links used to protect their optional
// password with an unsalted SHA-256 - a weak password could be cracked
// offline via a precomputed table (same hash for same password everywhere).
// Now every share password gets its own random salt + 100k-iteration PBKDF2
// (same primitive as auth/session.ts user passwords). The stored format
// `pbkdf2$<iters>$<salt>$<hash>` is backward compatible with the old plain
// SHA-256 hex (treated as a legacy value, verified directly then transparently
// rehashed on next set) so existing links keep working.
// ---------------------------------------------------------------------------

import crypto from "crypto";

const ALGORITHM = "pbkdf2-sha256";
const ITERATIONS = 100_000;
const KEYLEN = 32; // 256-bit derived key
const SALT_LEN = 16;

/** Hash a plaintext share password (random salt + PBKDF2). */
export function hashSharePassword(plaintext: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.pbkdf2Sync(plaintext, salt, ITERATIONS, KEYLEN, "sha256");
  return `${ALGORITHM}$${ITERATIONS}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Verify a plaintext password against a stored hash.
 *  Accepts the new PBKDF2 format AND legacy unsalted SHA-256 hex (L-2 compat). */
export function verifySharePassword(plaintext: string, stored: string): boolean {
  if (stored.startsWith(`${ALGORITHM}$`)) {
    const parts = stored.split("$");
    if (parts.length !== 4) return false;
    const iters = parseInt(parts[1], 10);
    const salt = Buffer.from(parts[2], "base64");
    const expected = Buffer.from(parts[3], "base64");
    const hash = crypto.pbkdf2Sync(plaintext, salt, iters, KEYLEN, "sha256");
    return crypto.timingSafeEqual(hash, expected);
  }
  // Legacy unsalted SHA-256 hex - verify directly (kept so existing links
  // remain usable until their password is re-set).
  return crypto.createHash("sha256").update(plaintext).digest("hex") === stored;
}
