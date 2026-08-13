// ---------------------------------------------------------------------------
// TOTP (Time-Based One-Time Password) - RFC 6238 via otplib v13.
//
// otplib is the standard TOTP/HOTP library (RFC 6238/4226) - replaced the
// hand-rolled HMAC implementation in 2026-08 (P7-5). Compatible with Google
// Authenticator, Microsoft Authenticator, 1Password, Authy, and any standard
// TOTP app. otplib's epoch is in SECONDS (not ms).
// ---------------------------------------------------------------------------

import { generateSecret as otplibSecret, generateSync, generateURI, verifySync } from "otplib";
import crypto from "crypto"; // backup codes only (SHA-256 hashing, not TOTP)

// ── TOTP core ────────────────────────────────────────────────────────────

const STEP = 30; // seconds
const DIGITS = 6;
const WINDOW = 1; // accept codes from current ± 1 step (±30s)

/** Generate a random TOTP secret (20 bytes = 160 bits, Base32 encoded). */
export function generateSecret(): string {
  return otplibSecret({ length: 20 });
}

/**
 * Generate a TOTP code for the given secret and timestamp (ms).
 * Implements HOTP with HMAC-SHA1 (RFC 6238 defaults).
 */
export function generateTOTP(secret: string, timestamp: number = Date.now()): string {
  return generateSync({
    secret,
    algorithm: "sha1",
    digits: DIGITS,
    period: STEP,
    epoch: Math.floor(timestamp / 1000),
  });
}

/**
 * Verify a TOTP code against the secret.
 * Accepts codes within ±WINDOW steps (±30s) to account for clock drift.
 * NOTE: otplib's `epochTolerance` is expressed in epoch SECONDS, not steps -
 * ±1 step means epochTolerance = period (30s).
 */
export function verifyTOTP(secret: string, token: string, timestamp: number = Date.now()): boolean {
  const code = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  return verifySync({
    secret,
    token: code,
    algorithm: "sha1",
    digits: DIGITS,
    period: STEP,
    epoch: Math.floor(timestamp / 1000),
    epochTolerance: WINDOW * STEP,
  }).valid;
}

// ── OTPAuth URI (for QR codes) ───────────────────────────────────────────

/**
 * Generate an otpauth:// URI for QR code generation.
 * Format: otpauth://totp/ISSUER:LABEL?secret=SECRET&issuer=ISSUER
 * (algorithm/digits/period are RFC 6238 defaults and omitted, as the
 * otpauth spec allows; all standard authenticator apps accept this).
 */
export function generateOTPAuthURI(
  secret: string,
  email: string,
  issuer: string = "KnowledgeAI"
): string {
  return generateURI({
    secret,
    issuer,
    label: email,
    algorithm: "sha1",
    digits: DIGITS,
    period: STEP,
  });
}

// ── Backup codes ─────────────────────────────────────────────────────────

/** Generate 8 one-time backup codes (format: XXXX-XXXX). */
export function generateBackupCodes(): string[] {
  return Array.from({ length: 8 }, () => {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  });
}

/** Hash a backup code for secure storage (SHA-256). */
export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/** Verify a backup code against hashed codes and return the remaining codes. */
export function verifyBackupCode(
  code: string,
  hashedCodes: string[]
): { valid: boolean; remaining: string[] } {
  const hash = hashBackupCode(code.trim().toUpperCase());
  const idx = hashedCodes.indexOf(hash);
  if (idx === -1) return { valid: false, remaining: hashedCodes };
  return {
    valid: true,
    remaining: hashedCodes.filter((_, i) => i !== idx),
  };
}
