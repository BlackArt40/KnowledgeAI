// ---------------------------------------------------------------------------
// TOTP (Time-Based One-Time Password) - RFC 6238 implementation.
//
// Uses Node.js built-in crypto (no external dependencies).
// Compatible with Google Authenticator, Microsoft Authenticator, 1Password,
// Authy, and any standard TOTP app.
//
// Algorithm: HOTP(K, T) where T = floor(unix_time / 30)
//   HOTP uses HMAC-SHA1 with dynamic truncation.
// ---------------------------------------------------------------------------

import crypto from "crypto";

// ── Base32 encoding/decoding ─────────────────────────────────────────────

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode a buffer to Base32 (RFC 4648). */
export function base32Encode(buf: Buffer): string {
  let result = "";
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 31];
  }
  return result;
}

/** Decode a Base32 string to a buffer. */
export function base32Decode(str: string): Buffer {
  const clean = str.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ── TOTP core ────────────────────────────────────────────────────────────

const STEP = 30; // seconds
const DIGITS = 6;
const WINDOW = 1; // accept codes from current ± 1 step (±30s)

/** Generate a random TOTP secret (20 bytes = 160 bits, Base32 encoded). */
export function generateSecret(): string {
  const secret = crypto.randomBytes(20);
  return base32Encode(secret);
}

/**
 * Generate a TOTP code for the given secret and timestamp.
 * Implements HOTP with HMAC-SHA1.
 */
export function generateTOTP(secret: string, timestamp: number = Date.now()): string {
  const key = base32Decode(secret);
  const counter = Math.floor(timestamp / 1000 / STEP);
  const counterBuf = Buffer.alloc(8);
  // Write counter as big-endian 64-bit
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key);
  hmac.update(counterBuf);
  const hash = hmac.digest();

  // Dynamic truncation (RFC 4226)
  const offset = hash[hash.length - 1] & 0x0f;
  const truncated = (
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)
  );

  const code = truncated % Math.pow(10, DIGITS);
  return code.toString().padStart(DIGITS, "0");
}

/**
 * Verify a TOTP code against the secret.
 * Accepts codes within ±WINDOW steps (±30s) to account for clock drift.
 */
export function verifyTOTP(secret: string, token: string, timestamp: number = Date.now()): boolean {
  const code = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;

  for (let offset = -WINDOW; offset <= WINDOW; offset++) {
    const adjustedTime = timestamp + offset * STEP * 1000;
    if (generateTOTP(secret, adjustedTime) === code) {
      return true;
    }
  }
  return false;
}

// ── OTPAuth URI (for QR codes) ───────────────────────────────────────────

/**
 * Generate an otpauth:// URI for QR code generation.
 * Format: otpauth://totp/LABEL?secret=SECRET&issuer=ISSUER&algorithm=SHA1&digits=6&period=30
 */
export function generateOTPAuthURI(
  secret: string,
  email: string,
  issuer: string = "KnowledgeAI"
): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: DIGITS.toString(),
    period: STEP.toString(),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
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
