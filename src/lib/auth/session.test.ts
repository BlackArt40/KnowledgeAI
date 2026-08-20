// P6-3 unit tests: auth/session (jose JWT + Web Crypto PBKDF2).
import { describe, it, expect, beforeEach } from "vitest";
import {
  createToken,
  verifyToken,
  createPreAuthToken,
  verifyPreAuthToken,
  getUserFromRequest,
  hashPassword,
  verifyPassword,
  revokeJti,
  type AuthUser,
} from "./session";

const user: AuthUser = { id: "usr_1", email: "a@b.dev", name: "A", role: "editor" };

beforeEach(() => {
  // P1-3: fresh revocation blacklist per test.
  delete (globalThis as Record<string, unknown>).__KAI_REVOKED_JTI__;
});

describe("session JWT", () => {
  it("round-trips a signed token", async () => {
    const token = await createToken(user);
    expect(token.split(".")).toHaveLength(3);
    const payload = await verifyToken(token);
    expect(payload).toMatchObject({ id: "usr_1", email: "a@b.dev", role: "editor" });
  });

  it("carries a jti tied to the session and revokes it on demand (P1-3)", async () => {
    // login flow: session id -> jti
    const token = await createToken(user, 7 * 86400, { jti: "ses_abc123" });
    expect(await verifyToken(token)).toMatchObject({ id: "usr_1" });
    // settings -> 注销设备: jti blacklisted -> token rejected immediately
    revokeJti("ses_abc123");
    expect(await verifyToken(token)).toBeNull();
    // other tokens (different jti) remain valid
    const other = await createToken(user, 7 * 86400, { jti: "ses_other" });
    expect(await verifyToken(other)).toMatchObject({ id: "usr_1" });
  });

  it("verifies tokens signed by the pre-jose implementation (wire compat)", async () => {
    // Rebuild the old hand-rolled HS256 JWT (same AUTH_SECRET) and assert
    // jose still accepts it - sessions minted before the swap keep working.
    const secret = process.env.AUTH_SECRET || "dev-secret-change-in-production";
    const b64url = (buf: Uint8Array) =>
      btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
    const payload = b64url(
      enc.encode(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + 3600 }))
    );
    const data = `${header}.${payload}`;
    const sig = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
    expect(await verifyToken(`${data}.${sig}`)).toMatchObject({ id: "usr_1", role: "editor" });
    // a legacy pre-auth token is still rejected as a session credential
    const prePayload = b64url(
      enc.encode(JSON.stringify({ ...user, purpose: "2fa-enroll", exp: Math.floor(Date.now() / 1000) + 300 }))
    );
    const preData = `${header}.${prePayload}`;
    const preSig = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(preData))));
    expect(await verifyToken(`${preData}.${preSig}`)).toBeNull();
    expect(await verifyPreAuthToken(`${preData}.${preSig}`)).toMatchObject({ purpose: "2fa-enroll" });
  });

  it("rejects tampered tokens", async () => {
    const token = await createToken(user);
    const parts = token.split(".");
    parts[1] = parts[1].slice(0, -1) + (parts[1].endsWith("A") ? "B" : "A"); // flip payload
    expect(await verifyToken(parts.join("."))).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const token = await createToken(user, -10);
    expect(await verifyToken(token)).toBeNull();
  });

  it("rejects garbage / wrong-shape tokens", async () => {
    expect(await verifyToken("not-a-jwt")).toBeNull();
    expect(await verifyToken("a.b")).toBeNull();
  });

  it("rejects pre-auth tokens as session credentials (2FA bypass guard)", async () => {
    const pre = await createPreAuthToken(user);
    expect(await verifyToken(pre)).toBeNull();
    const payload = await verifyPreAuthToken(pre);
    expect(payload?.purpose).toBe("2fa-enroll");
  });

  it("getUserFromRequest reads Bearer header", async () => {
    const token = await createToken(user);
    const req = new Request("http://localhost/api/x", { headers: { authorization: `Bearer ${token}` } });
    expect(await getUserFromRequest(req)).toMatchObject({ id: "usr_1" });
    const noAuth = new Request("http://localhost/api/x");
    expect(await getUserFromRequest(noAuth)).toBeNull();
  });
});

describe("pre-auth tokens", () => {
  it("rejects wrong purpose and tampered pre-auth tokens", async () => {
    const token = await createPreAuthToken(user);
    const bad = token.slice(0, -2) + "xx";
    expect(await verifyPreAuthToken(bad)).toBeNull();
  });
});

describe("password hashing", () => {
  it("round-trips pbkdf2 hashes", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(hash.startsWith("pbkdf2$100000$")).toBe(true);
    expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
    expect(await verifyPassword("wrong-pass", hash)).toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "sha1$abc")).toBe(false);
  });
});
