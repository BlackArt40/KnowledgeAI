// ---------------------------------------------------------------------------
// AUTH_SECRET resolution (P0-2) - single source of truth for the signing /
// encryption key lookup.
//
// In production (NODE_ENV=production) a missing AUTH_SECRET is a FATAL
// configuration error: every JWT, AES-encrypted API key / 2FA secret / model
// key and audit HMAC would silently fall back to a publicly-known hardcoded
// key, letting an attacker forge sessions and decrypt everything at rest.
// We refuse to start instead - enforced here at first lookup and eagerly at
// server boot (instrumentation-node.ts / worker.ts). The ONLY exception is
// `next build` itself (NEXT_PHASE=phase-production-build): page-data
// collection merely evaluates route modules - nothing gets signed or
// encrypted - and CI / Docker builds run without secrets by design.
//
// In demo / test mode the hardcoded fallback is kept (deterministic dev
// behavior, no real data) but a one-time warning is emitted.
// ---------------------------------------------------------------------------

let warned = false;

/** Resolve AUTH_SECRET. `fallback` keeps each caller's existing dev key so
 *  previously-encrypted demo data stays decryptable. Throws at runtime in
 *  production when AUTH_SECRET is unset (skipped during `next build`). */
export function getAuthSecret(fallback: string): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    throw new Error(
      "AUTH_SECRET 未配置：生产环境拒绝启动（JWT 签名 / AES 加密 / 审计 HMAC 共用该密钥，缺省回退硬编码密钥可导致任意账号伪造与敏感数据解密）"
    );
  }
  if (!warned) {
    warned = true;
    console.warn("[security] AUTH_SECRET 未配置，使用开发回退密钥（仅限 demo/test 环境，生产环境将拒绝启动）");
  }
  return fallback;
}
