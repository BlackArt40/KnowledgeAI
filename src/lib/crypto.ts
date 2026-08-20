// ---------------------------------------------------------------------------
// Encryption utility - AES-256-GCM for encrypting sensitive data at rest.
//
// Used for:
//   - API key secrets (stored encrypted in DB)
//   - 2FA TOTP secrets (stored encrypted in DB)
//   - User model API keys (stored encrypted in DB)
//
// The encryption key is derived from AUTH_SECRET using HKDF (RFC 5869).
// When AUTH_SECRET is not set, falls back to a deterministic dev key.
// ---------------------------------------------------------------------------

import crypto from "crypto";
import { getAuthSecret } from "@/lib/secrets";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits (recommended for GCM)

/** Derive a 256-bit encryption key from AUTH_SECRET using HKDF. */
function getEncryptionKey(): Buffer {
  const secret = getAuthSecret("knowledgeai-dev-secret-change-me");
  return crypto.hkdfSync("sha256", secret, Buffer.from("knowledgeai"), "encryption-key", KEY_LENGTH) as unknown as Buffer;
}

export interface EncryptedData {
  iv: string;        // Base64 IV
  data: string;      // Base64 ciphertext
  tag: string;       // Base64 auth tag
}

/** Encrypt a string using AES-256-GCM. */
export function encrypt(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    data: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/** Decrypt data encrypted with encrypt(). */
export function decrypt(enc: EncryptedData): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(enc.iv, "base64");
  const tag = Buffer.from(enc.tag, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(enc.data, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

/** Encrypt and serialize to a single string (for DB storage). */
export function encryptToString(plaintext: string): string {
  const enc = encrypt(plaintext);
  return JSON.stringify(enc);
}

/** Deserialize and decrypt from a string. Legacy plaintext values are
 *  returned as-is (pre-P3-4 rows); encrypted values that fail to decrypt
 *  (e.g. AUTH_SECRET rotation) THROW so callers can treat them as invalid
 *  instead of silently matching plaintext. */
export function decryptFromString(serialized: string): string {
  if (!isEncrypted(serialized)) return serialized; // legacy plaintext
  const enc = JSON.parse(serialized) as EncryptedData;
  return decrypt(enc); // GCM auth-tag mismatch throws here
}

/** Check if a string looks like encrypted data (JSON with iv/data/tag). */
export function isEncrypted(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return parsed.iv && parsed.data && parsed.tag;
  } catch {
    return false;
  }
}
