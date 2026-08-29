// P8 unit tests: email verification (src/lib/auth/email-verify.ts).
// Same globalThis-store pattern as password-reset.test.ts - no mocks needed.
import { describe, it, expect, beforeEach } from "vitest";
import { seed, findUserByEmail } from "./store";
import {
  issueEmailVerification,
  consumeEmailVerification,
  verifyEmail,
  VERIFY_ERROR_INVALID,
  VERIFY_ERROR_EXPIRED,
} from "./email-verify";
import { hashToken } from "./token-hash";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_USER_STORE__;
  seed();
});

describe("issueEmailVerification", () => {
  it("returns a userId.secret token and stores only its SHA-256 hash", () => {
    const token = issueEmailVerification("owner@knowledgeai.dev")!;
    expect(token.startsWith("usr_owner.")).toBe(true);
    const user = findUserByEmail("owner@knowledgeai.dev")!;
    expect(user.verificationTokenHash).toBe(hashToken(token));
    expect(user.verificationTokenHash).not.toBe(token);
    expect(user.verificationExpires).toBeGreaterThan(Date.now());
    expect(user.emailVerifiedAt).toBeUndefined();
  });

  it("returns null for unknown emails and already-verified accounts", () => {
    expect(issueEmailVerification("ghost@nowhere.dev")).toBeNull();
    // mark verified, then no token should be issued
    const user = findUserByEmail("editor@knowledgeai.dev")!;
    user.emailVerifiedAt = Date.now();
    expect(issueEmailVerification("editor@knowledgeai.dev")).toBeNull();
  });

  it("re-issuing supersedes the previous token (single active)", async () => {
    const first = issueEmailVerification("admin@knowledgeai.dev")!;
    const second = issueEmailVerification("admin@knowledgeai.dev")!;
    expect(first).not.toBe(second);
    const user = findUserByEmail("admin@knowledgeai.dev")!;
    expect(user.verificationTokenHash).toBe(hashToken(second));
    expect(await consumeEmailVerification(first)).toEqual({ error: VERIFY_ERROR_INVALID });
  });
});

describe("consumeEmailVerification", () => {
  it("accepts a valid token", async () => {
    const token = issueEmailVerification("viewer@knowledgeai.dev")!;
    const r = await consumeEmailVerification(token);
    expect(r).toEqual({
      ok: true,
      email: "viewer@knowledgeai.dev",
      user: expect.objectContaining({ email: "viewer@knowledgeai.dev" }),
    });
  });

  it("rejects malformed / wrong tokens", async () => {
    expect(await consumeEmailVerification("garbage")).toEqual({ error: VERIFY_ERROR_INVALID });
    expect(await consumeEmailVerification("usr_viewer.wrongsecret")).toEqual({ error: VERIFY_ERROR_INVALID });
    expect(await consumeEmailVerification("missing_user.abc")).toEqual({ error: VERIFY_ERROR_INVALID });
  });

  it("rejects expired tokens", async () => {
    const token = issueEmailVerification("admin@knowledgeai.dev")!;
    const user = findUserByEmail("admin@knowledgeai.dev")!;
    user.verificationExpires = Date.now() - 1000;
    expect(await consumeEmailVerification(token)).toEqual({ error: VERIFY_ERROR_EXPIRED });
  });
});

describe("verifyEmail", () => {
  it("marks the inbox verified, clears the token and is single-use", async () => {
    const token = issueEmailVerification("viewer@knowledgeai.dev")!;
    const user = findUserByEmail("viewer@knowledgeai.dev")!;
    const r = await verifyEmail(token);
    expect(r).toEqual({ ok: true, email: "viewer@knowledgeai.dev", userId: user.id });

    const fresh = findUserByEmail("viewer@knowledgeai.dev")!;
    expect(fresh.emailVerifiedAt).toBeGreaterThan(0);
    expect(fresh.verificationTokenHash).toBeUndefined();
    expect(fresh.verificationExpires).toBeUndefined();

    // consumed - replay is rejected
    expect(await verifyEmail(token)).toEqual({ error: VERIFY_ERROR_INVALID });
  });

  it("concurrent replays of the same token: exactly one verify succeeds", async () => {
    const token = issueEmailVerification("editor@knowledgeai.dev")!;
    // verifyEmail mutates synchronously after its (now sync) consume, so a
    // concurrent second call must hit the already-cleared hash - no window.
    const [a, b] = await Promise.all([verifyEmail(token), verifyEmail(token)]);
    const results = [a, b] as Array<{ ok?: boolean; error?: string }>;
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(findUserByEmail("editor@knowledgeai.dev")!.emailVerifiedAt).toBeGreaterThan(0);
    expect(await verifyEmail(token)).toEqual({ error: VERIFY_ERROR_INVALID });
  });
});