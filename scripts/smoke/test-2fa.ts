// @ts-nocheck
// P3-1 acceptance verification: real 2FA (TOTP).
//   #1 RFC 6238 TOTP (generate / verify / time window)
//   #2 otpauth:// URI compatible with mainstream authenticator apps
//   #3 Backup recovery codes: SHA-256 hashed, one-time use, auto-invalidated
//   #4 QR Code rendered as a scannable data URL
//   #5 Enrollment flow: start -> verify -> enabled
//   #6 Login flow: password -> 2FA verify -> session (requires2FA logic)
//   #7 Forced enrollment policy: admin requires role -> mustEnroll2FA -> preAuthToken
//   #8 Disable flow + getSecurity sanitization (no hashed codes leaked)
// Run: npx tsx scripts/smoke/test-2fa.ts
import {
  generateSecret, generateTOTP, verifyTOTP,
  generateOTPAuthURI, generateBackupCodes, hashBackupCode, verifyBackupCode,
} from "../../src/lib/security/totp";
import { renderOtpAuthQR } from "../../src/lib/security/qr";
import {
  start2FAEnrollment, verify2FAEnrollment, verify2FALogin, is2FAEnabled,
  disable2FA, getSecurity, mustEnroll2FA, is2FARequiredForRole,
} from "../../src/lib/security/store";
import { updateConfig } from "../../src/lib/admin/store";
import { createPreAuthToken, verifyPreAuthToken } from "../../src/lib/auth/session";

async function main() {
  let failures = 0;
  const results: string[] = [];
  function check(name: string, cond: boolean, detail = "") {
    if (cond) { results.push(`✅ ${name}`); }
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  // ── 1. RFC 6238 TOTP ──────────────────────────────────────────────────
  const secret = generateSecret();
  check("TOTP: secret is 32-char Base32", /^[A-Z2-7]{32}$/.test(secret), `got ${secret}`);
  const code = generateTOTP(secret, Date.now());
  check("TOTP: code is 6 digits", /^\d{6}$/.test(code), `got ${code}`);
  check("TOTP: verify accepts current code", verifyTOTP(secret, code, Date.now()));
  check("TOTP: verify rejects wrong code", !verifyTOTP(secret, "000000", Date.now()) || code === "000000");
  check("TOTP: verify rejects malformed", !verifyTOTP(secret, "abc", Date.now()));
  // ±1 step window (±30s clock drift)
  const pastCode = generateTOTP(secret, Date.now() - 30_000);
  check("TOTP: accepts previous step (clock drift -30s)", verifyTOTP(secret, pastCode, Date.now()));
  const futureCode = generateTOTP(secret, Date.now() + 30_000);
  check("TOTP: accepts next step (clock drift +30s)", verifyTOTP(secret, futureCode, Date.now()));
  // Outside window (±60s) should be rejected
  const farCode = generateTOTP(secret, Date.now() - 60_000);
  check("TOTP: rejects -60s (outside window)", !verifyTOTP(secret, farCode, Date.now()));
  // RFC 6238 reference vector: secret "12345678901234567890" at T0 -> known code.
  // (The RFC test secret is ASCII; Base32 of those 20 bytes is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  // T=59 (counter=1) -> 287082 per RFC 4226/6238 test vectors
  check("TOTP: RFC 6238 vector T=59 -> 287082", generateTOTP(rfcSecret, 59_000) === "287082", `got ${generateTOTP(rfcSecret, 59_000)}`);

  // ── 2. otpauth:// URI ─────────────────────────────────────────────────
  const uri = generateOTPAuthURI(secret, "user@example.com", "KnowledgeAI");
  check("URI: starts with otpauth://totp/", uri.startsWith("otpauth://totp/"));
  check("URI: contains encoded label KnowledgeAI:user@example.com", uri.includes("KnowledgeAI%3Auser%40example.com"));
  check("URI: contains secret param", uri.includes(`secret=${secret}`));
  check("URI: contains issuer=KnowledgeAI", uri.includes("issuer=KnowledgeAI"));
  check("URI: contains algorithm=SHA1", uri.includes("algorithm=SHA1"));
  check("URI: contains digits=6", uri.includes("digits=6"));
  check("URI: contains period=30", uri.includes("period=30"));

  // ── 3. Backup codes: one-time use ─────────────────────────────────────
  const backups = generateBackupCodes();
  check("backup: generates 8 codes", backups.length === 8);
  check("backup: format XXXX-XXXX (8 hex chars)", backups.every((c) => /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(c)));
  const hashed = backups.map(hashBackupCode);
  check("backup: hash is 64-char SHA-256 hex", hashed.every((h) => /^[0-9a-f]{64}$/.test(h)));
  check("backup: hash differs from plaintext", hashed.every((h, i) => h !== backups[i]));
  const first = backups[0];
  const r1 = verifyBackupCode(first, hashed);
  check("backup: valid code accepted", r1.valid);
  check("backup: used code removed from remaining", r1.remaining.length === hashed.length - 1);
  // Re-using the same code against the remaining set must fail (one-time use).
  const r2 = verifyBackupCode(first, r1.remaining);
  check("backup: reused code rejected (one-time)", !r2.valid);
  check("backup: remaining unchanged after failed reuse", r2.remaining.length === r1.remaining.length);
  check("backup: wrong code rejected", !verifyBackupCode("DEAD-BEEF", hashed).valid);
  // Case-insensitive + whitespace tolerant
  check("backup: lowercase accepted", verifyBackupCode(first.toLowerCase(), hashed).valid);
  check("backup: whitespace trimmed", verifyBackupCode(` ${first} `, hashed).valid);

  // ── 4. QR Code data URL ───────────────────────────────────────────────
  const qr = await renderOtpAuthQR(uri);
  check("QR: returns data URL", qr.dataUrl.startsWith("data:image/"));
  check("QR: png or svg base64 payload", qr.dataUrl.length > 200);
  check("QR: uri echoed back", qr.uri === uri);

  // ── 5. Enrollment flow (store-level) ──────────────────────────────────
  const userId = "usr_2fa_smoke";
  const enroll = start2FAEnrollment(userId, "smoke@example.com");
  check("enroll: returns secret", !!enroll.secret);
  check("enroll: returns qrCodeUri", enroll.qrCodeUri.startsWith("otpauth://"));
  check("enroll: returns 8 plaintext backup codes", enroll.backupCodes.length === 8);
  check("enroll: not yet enabled", !is2FAEnabled(userId));
  // Verify with a wrong code -> stays disabled
  check("enroll: wrong code rejected", !verify2FAEnrollment(userId, "000000") || generateTOTP(enroll.secret) === "000000");
  check("enroll: still not enabled after wrong code", !is2FAEnabled(userId));
  // Verify with the correct current code -> enabled
  const validCode = generateTOTP(enroll.secret, Date.now());
  check("enroll: correct code accepted", verify2FAEnrollment(userId, validCode));
  check("enroll: now enabled", is2FAEnabled(userId));

  // ── 6. Login flow: password -> 2FA verify ─────────────────────────────
  // Simulate the login route's 2FA step: a user with 2FA enabled must supply
  // a code; verify2FALogin validates TOTP or backup code.
  const loginCode = generateTOTP(enroll.secret, Date.now());
  check("login: TOTP code accepted", verify2FALogin(userId, loginCode));
  check("login: wrong code rejected", !verify2FALogin(userId, "999999"));
  // Backup code login: use one of the plaintext codes from enrollment.
  const backupLogin = enroll.backupCodes[1];
  check("login: backup code accepted", verify2FALogin(userId, backupLogin));
  // The used backup code must now be invalid (one-time, auto-invalidated).
  check("login: used backup code now invalid", !verify2FALogin(userId, backupLogin));

  // ── 8. getSecurity sanitization ───────────────────────────────────────
  const sec = getSecurity(userId);
  check("security: enabled reflected", sec.twoFactor.enabled === true);
  check("security: hashed backup codes NOT leaked (empty)", Array.isArray(sec.twoFactor.backupCodes) && sec.twoFactor.backupCodes.length === 0);
  check("security: backupCodesRemaining is a count", typeof sec.twoFactor.backupCodesRemaining === "number" && sec.twoFactor.backupCodesRemaining >= 0);
  // We used 1 backup code, so remaining should be 7.
  check("security: remaining count = 7 after one use", sec.twoFactor.backupCodesRemaining === 7, `got ${sec.twoFactor.backupCodesRemaining}`);

  // Disable flow
  const disableCode = generateTOTP(enroll.secret, Date.now());
  check("disable: code accepted", verify2FALogin(userId, disableCode));
  disable2FA(userId);
  check("disable: 2FA now off", !is2FAEnabled(userId));
  check("disable: getSecurity shows disabled", getSecurity(userId).twoFactor.enabled === false);

  // ── 7. Forced enrollment policy (admin requires role) ─────────────────
  // Configure admin to require 2FA for the "admin" role.
  updateConfig({ required2FARoles: ["admin"] });
  check("policy: admin role required", is2FARequiredForRole("admin"));
  check("policy: editor role not required", !is2FARequiredForRole("editor"));
  // A fresh admin user without 2FA must enroll.
  const adminUser = "usr_admin_2fa";
  check("policy: mustEnroll2FA true for unenrolled admin", mustEnroll2FA(adminUser, "admin"));
  // After enrolling, no longer forced.
  const admEnroll = start2FAEnrollment(adminUser, "admin@example.com");
  verify2FAEnrollment(adminUser, generateTOTP(admEnroll.secret, Date.now()));
  check("policy: mustEnroll2FA false after enrollment", !mustEnroll2FA(adminUser, "admin"));
  // A viewer is never forced even without 2FA.
  check("policy: viewer not forced", !mustEnroll2FA("usr_viewer", "viewer"));
  // Reset policy.
  updateConfig({ required2FARoles: [] });

  // ── 7b. Pre-auth token (forced enrollment authorization) ──────────────
  const preAuthUser = { id: "usr_preauth", email: "pre@example.com", name: "Pre", role: "admin" as const };
  const preToken = await createPreAuthToken(preAuthUser);
  check("preauth: token is 3-part JWT", preToken.split(".").length === 3);
  const payload = await verifyPreAuthToken(preToken);
  check("preauth: verifies + returns payload", !!payload && payload.id === "usr_preauth");
  check("preauth: payload purpose is 2fa-enroll", payload?.purpose === "2fa-enroll");
  // A regular session token must NOT validate as a pre-auth token (purpose mismatch).
  const { createToken } = await import("../../src/lib/auth/session");
  const sessionToken = await createToken(preAuthUser);
  check("preauth: session token rejected (wrong purpose)", !(await verifyPreAuthToken(sessionToken)));
  // Tampered token rejected
  check("preauth: tampered token rejected", !(await verifyPreAuthToken(preToken + "x")));

  // ── Summary ───────────────────────────────────────────────────────────
  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "✅ ALL PASSED" : `❌ ${failures} FAILED`} (${results.length} checks)`);
  // Cleanup test data
  disable2FA(userId);
  disable2FA(adminUser);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
