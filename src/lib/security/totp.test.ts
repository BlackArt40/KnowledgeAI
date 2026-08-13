// P7-5 adapter tests: security/totp (RFC 6238 via otplib).
// The RFC 6238 appendix-B vectors pin the adapter's epoch/digits/period
// handling (epoch is in seconds for otplib v13).
import { describe, it, expect } from "vitest";
import {
  generateSecret,
  generateTOTP,
  verifyTOTP,
  generateOTPAuthURI,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from "./totp";

// base32("12345678901234567890") - the RFC 6238 shared test secret
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP generation (RFC 6238 vectors)", () => {
  const VECTORS: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];

  it.each(VECTORS)("matches RFC 6238 vector at T=%d", (epochSec, expected) => {
    // generateTOTP takes ms - the adapter converts to seconds internally
    expect(generateTOTP(RFC_SECRET, epochSec * 1000)).toBe(expected);
  });
});

describe("TOTP verification", () => {
  it("accepts the current code", () => {
    const secret = generateSecret();
    const code = generateTOTP(secret);
    expect(verifyTOTP(secret, code)).toBe(true);
  });

  it("accepts codes within the ±1 step window (±30s)", () => {
    const secret = generateSecret();
    const now = Date.now();
    const past = generateTOTP(secret, now - 30_000);
    const future = generateTOTP(secret, now + 30_000);
    expect(verifyTOTP(secret, past, now)).toBe(true);
    expect(verifyTOTP(secret, future, now)).toBe(true);
  });

  it("rejects wrong codes, non-6-digit input and whitespace handling", () => {
    const secret = generateSecret();
    const code = generateTOTP(secret);
    expect(verifyTOTP(secret, code === "000000" ? "000001" : "000000")).toBe(false);
    expect(verifyTOTP(secret, "12345")).toBe(false);
    expect(verifyTOTP(secret, "abcdef")).toBe(false);
    expect(verifyTOTP(secret, ` ${code} `)).toBe(true); // whitespace stripped
  });

  it("rejects codes outside the window", () => {
    const secret = generateSecret();
    const now = Date.now();
    const far = generateTOTP(secret, now - 3 * 30_000); // 3 steps away
    expect(verifyTOTP(secret, far, now)).toBe(false);
  });
});

describe("secrets and otpauth URIs", () => {
  it("generateSecret returns a base32 secret of the expected shape", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(secret).not.toBe(generateSecret());
  });

  it("generateOTPAuthURI carries secret/issuer/label", () => {
    const secret = generateSecret();
    const uri = generateOTPAuthURI(secret, "user@example.com", "KnowledgeAI");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("issuer=KnowledgeAI");
    expect(uri).toContain("user%40example.com");
  });
});

describe("backup codes (SHA-256 hashed, not TOTP)", () => {
  it("generates 8 codes in XXXX-XXXX format", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(8);
    for (const c of codes) expect(c).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it("hashes and verifies, removing the used code", () => {
    const codes = generateBackupCodes();
    const hashed = codes.map((c) => hashBackupCode(c));
    const r = verifyBackupCode(codes[0], hashed);
    expect(r.valid).toBe(true);
    expect(r.remaining).toHaveLength(hashed.length - 1);
    expect(r.remaining).not.toContain(hashed[0]);
    // wrong code leaves the list untouched
    const bad = verifyBackupCode("DEAD-BEEF", hashed);
    expect(bad.valid).toBe(false);
    expect(bad.remaining).toHaveLength(hashed.length);
  });
});
