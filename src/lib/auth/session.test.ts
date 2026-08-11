// P6-3 unit tests: auth/session (Web Crypto JWT + PBKDF2, zero deps).
import { describe, it, expect } from "vitest";
import {
  createToken,
  verifyToken,
  createPreAuthToken,
  verifyPreAuthToken,
  getUserFromRequest,
  hashPassword,
  verifyPassword,
  type AuthUser,
} from "./session";

const user: AuthUser = { id: "usr_1", email: "a@b.dev", name: "A", role: "editor" };

describe("session JWT", () => {
  it("round-trips a signed token", async () => {
    const token = await createToken(user);
    expect(token.split(".")).toHaveLength(3);
    const payload = await verifyToken(token);
    expect(payload).toMatchObject({ id: "usr_1", email: "a@b.dev", role: "editor" });
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
