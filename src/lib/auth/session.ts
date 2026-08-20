// ---------------------------------------------------------------------------
// Auth — JWT session utilities via jose (HS256, Web Crypto underneath).
// jose is the de-facto standard JWT library (already in the dependency tree
// through Auth.js v5); replaced the hand-rolled HMAC JWT in 2026-08 (P7-5).
// Tokens signed by the old implementation remain verifiable (same HS256 +
// same AUTH_SECRET) - see session.test.ts legacy-compat case.
// ---------------------------------------------------------------------------

import { SignJWT, jwtVerify, base64url } from "jose";
import { getAuthSecret } from "@/lib/secrets";

// P0-2: production refuses to start without AUTH_SECRET - never fall back to
// a hardcoded signing key in prod (would let anyone forge sessions).
const SECRET = getAuthSecret("dev-secret-change-in-production");
const secretKey = new TextEncoder().encode(SECRET);

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "editor" | "viewer";
}

/** Create a signed JWT for a user. `opts.jti` (default: random UUID) lets
 *  callers tie the token to an active session record so revoking that session
 *  (settings -> 注销设备) also invalidates the token (P1-3). */
export async function createToken(
  user: AuthUser,
  expiresInSeconds = 7 * 86400,
  opts: { jti?: string } = {}
): Promise<string> {
  return new SignJWT({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    jti: opts.jti ?? crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secretKey);
}

// ── Pre-auth token (2FA forced enrollment) ────────────────────────────────
//
// When an admin requires 2FA for a role and a user without 2FA tries to log
// in, the password is verified but no session is issued yet. Instead a short-
// lived pre-auth token (purpose: "2fa-enroll") is returned so the client can
// complete TOTP enrollment. Only after enrollment succeeds does the user get a
// real session token. Reuses the same HMAC key as session JWTs.

export interface PreAuthPayload {
  id: string;
  email: string;
  name: string;
  role: string;
  purpose: "2fa-enroll";
  exp: number;
}

/** Create a short-lived pre-auth token for 2FA forced enrollment (default 5 min). */
export async function createPreAuthToken(user: AuthUser, expiresInSeconds = 5 * 60): Promise<string> {
  return new SignJWT({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    purpose: "2fa-enroll",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secretKey);
}

/** Verify a pre-auth token and return its payload, or null if invalid/expired/wrong purpose. */
export async function verifyPreAuthToken(token: string): Promise<PreAuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
    if (payload.purpose !== "2fa-enroll") return null;
    if (typeof payload.id !== "string" || typeof payload.email !== "string") return null;
    return {
      id: payload.id,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
      role: typeof payload.role === "string" ? payload.role : "",
      purpose: "2fa-enroll",
      exp: typeof payload.exp === "number" ? payload.exp : 0,
    };
  } catch {
    return null;
  }
}

// ── P1-3: JWT revocation (jti blacklist) ──────────────────────────────────
//
// Revoking a session used to only delete the in-memory session record - the
// 7-day JWT stayed valid (a stolen token kept working). Now every token
// carries a `jti` tied to its session id; revokeSession() / revokeAllSessions()
// add the jti to a global revocation set and verifyToken() rejects them.
//
// The set lives on globalThis as a Map<jti, revokedAt> with an 8-day TTL
// (tokens live 7 days; entries older than that can never match). NOTE: the
// Next.js Edge proxy runs in a separate isolate, so its globalThis is empty
// here - the proxy's verifyToken() call (rate-limit tiering only) stays
// permissive, while the real authorization in getRequestUser() (Node runtime,
// same process as the security store) enforces the blacklist.

declare global {
  var __KAI_REVOKED_JTI__: Map<string, number> | undefined;
}

const JTI_TTL_MS = 8 * 86400_000;

function revokedJtis(): Map<string, number> {
  if (!globalThis.__KAI_REVOKED_JTI__) globalThis.__KAI_REVOKED_JTI__ = new Map();
  return globalThis.__KAI_REVOKED_JTI__;
}

/** Mark a jti as revoked (called by revokeSession / revokeAllSessions). */
export function revokeJti(jti: string): void {
  revokedJtis().set(jti, Date.now());
}

/** True when the jti is on the blacklist (and not yet expired). */
export function isJtiRevoked(jti: string): boolean {
  const ts = revokedJtis().get(jti);
  if (ts === undefined) return false;
  if (Date.now() - ts > JTI_TTL_MS) {
    revokedJtis().delete(jti); // expired - can never match a live token
    return false;
  }
  return true;
}

/** Verify a JWT and return the user, or null if invalid/expired. */
export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
    // Reject scoped tokens such as the 2FA-enrollment pre-auth token. Only
    // purposeless session JWTs issued by createToken() are valid session
    // credentials; a token carrying a `purpose` field must be verified by its
    // dedicated verifier (verifyPreAuthToken), never treated as a session.
    // Without this check, a preAuthToken (same HMAC key, same JWT shape) would
    // be accepted here, letting users bypass forced 2FA enrollment.
    if (payload.purpose) return null;
    if (typeof payload.id !== "string" || typeof payload.email !== "string" || typeof payload.role !== "string") {
      return null;
    }
    // P1-3: a revoked jti (session terminated from settings) invalidates the
    // token even though its signature + expiry are still valid.
    if (typeof payload.jti === "string" && isJtiRevoked(payload.jti)) return null;
    return {
      id: payload.id,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
      role: payload.role as AuthUser["role"],
    };
  } catch {
    return null;
  }
}

/** Extract and verify user from a Request's Authorization header. */
export async function getUserFromRequest(req: Request): Promise<AuthUser | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return verifyToken(auth.slice(7));
}

/** Hash a password using PBKDF2 (Web Crypto). */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
  return `pbkdf2$100000$${base64url.encode(salt)}$${base64url.encode(new Uint8Array(hash))}`;
}

/** Verify a password against a hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  // copy into an ArrayBuffer-backed view (BufferSource for subtle.deriveBits)
  const salt = new Uint8Array(base64url.decode(parts[2]));
  const iterations = parseInt(parts[1], 10);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256
  );
  return base64url.encode(new Uint8Array(hash)) === parts[3];
}

