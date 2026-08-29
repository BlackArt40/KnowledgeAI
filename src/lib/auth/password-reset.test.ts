// P8 unit tests: password reset (src/lib/auth/password-reset.ts).
// All state lives on globalThis stores, so no mocks are needed - the same
// in-memory pattern as store.test.ts.
import { describe, it, expect, beforeEach } from "vitest";
import {
  seed,
  DEMO_PASSWORD,
  findUserByEmail,
  verifyCredentials,
  isAccountLocked,
  type User,
} from "./store";
import { addSession, getSecurity } from "@/lib/security/store";
import { isJtiRevoked } from "@/lib/auth/session";
import {
  issuePasswordReset,
  consumePasswordReset,
  resetPassword,
  RESET_ERROR_INVALID,
  RESET_ERROR_EXPIRED,
} from "./password-reset";
import { hashToken } from "./token-hash";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__KAI_USER_STORE__;
  delete (globalThis as Record<string, unknown>).__KAI_LOGIN_LOCKOUT__;
  delete (globalThis as Record<string, unknown>).__KAI_REVOKED_JTI__;
  seed();
});

describe("issuePasswordReset", () => {
  it("returns a userId.secret token and stores only its SHA-256 hash", () => {
    const token = issuePasswordReset("owner@knowledgeai.dev")!;
    expect(token.startsWith("usr_owner.")).toBe(true);
    const user = findUserByEmail("owner@knowledgeai.dev")!;
    // The store holds the hash, never the raw token.
    expect(user.passwordResetTokenHash).toBe(hashToken(token));
    expect(user.passwordResetTokenHash).not.toBe(token);
    expect(user.passwordResetExpires).toBeGreaterThan(Date.now());
  });

  it("re-issuing invalidates the previous token (single active reset)", async () => {
    const first = issuePasswordReset("owner@knowledgeai.dev")!;
    const second = issuePasswordReset("owner@knowledgeai.dev")!;
    expect(first).not.toBe(second);
    const user = findUserByEmail("owner@knowledgeai.dev")!;
    expect(user.passwordResetTokenHash).toBe(hashToken(second));
    expect(await consumePasswordReset(first)).toEqual({ error: RESET_ERROR_INVALID });
  });

  it("returns null for unknown emails without writing anything", () => {
    expect(issuePasswordReset("nobody@nowhere.dev")).toBeNull();
    expect(findUserByEmail("nobody@nowhere.dev")).toBeNull();
  });
});

describe("consumePasswordReset", () => {
  it("accepts a valid token", async () => {
    const token = issuePasswordReset("editor@knowledgeai.dev")!;
    const r = await consumePasswordReset(token);
    expect("user" in r && r.user.email).toBe("editor@knowledgeai.dev");
  });

  it("rejects malformed / wrong tokens", async () => {
    expect(await consumePasswordReset("garbage")).toEqual({ error: RESET_ERROR_INVALID });
    expect(await consumePasswordReset("usr_editor.wrongsecret")).toEqual({ error: RESET_ERROR_INVALID });
    expect(await consumePasswordReset("missing_user.abc")).toEqual({ error: RESET_ERROR_INVALID });
  });

  it("rejects expired tokens", async () => {
    const token = issuePasswordReset("admin@knowledgeai.dev")!;
    const user = findUserByEmail("admin@knowledgeai.dev")!;
    user.passwordResetExpires = Date.now() - 1000; // force expiry
    expect(await consumePasswordReset(token)).toEqual({ error: RESET_ERROR_EXPIRED });
  });
});

describe("resetPassword", () => {
  it("sets the new password, clears the token and revokes all sessions", async () => {
    const token = issuePasswordReset("viewer@knowledgeai.dev")!;
    const user = findUserByEmail("viewer@knowledgeai.dev")!;

    // simulate an active session (jti = session id) so revocation is observable
    const sessions = addSession(user.id, { device: "Mac", browser: "Chrome", ip: "127.0.0.1", location: "本地网络" });

    const r = await resetPassword(token, "brandnewpass1");
    expect((r as { ok?: boolean }).ok).toBe(true);

    // new password works, old one does not
    expect(await verifyCredentials("viewer@knowledgeai.dev", "brandnewpass1")).not.toBeNull();
    expect(await verifyCredentials("viewer@knowledgeai.dev", DEMO_PASSWORD)).toBeNull();

    // token consumed (single-use) + no vestiges on the user
    const fresh = findUserByEmail("viewer@knowledgeai.dev") as User;
    expect(fresh.passwordResetTokenHash).toBeUndefined();
    expect(fresh.passwordResetExpires).toBeUndefined();
    expect(await consumePasswordReset(token)).toEqual({ error: RESET_ERROR_INVALID });

    // every pre-reset session's jti is blacklisted
    expect(getSecurity(user.id).sessions).toHaveLength(0);
    expect(isJtiRevoked(sessions[0].id)).toBe(true);
  });

  it("rejects passwords shorter than 8 chars without consuming the token", async () => {
    const token = issuePasswordReset("editor@knowledgeai.dev")!;
    const r = await resetPassword(token, "short");
    expect(r).toEqual({ error: "新密码至少 8 位" });
    expect(await consumePasswordReset(token)).not.toEqual({ error: RESET_ERROR_INVALID });
  });

  it("concurrent replays of the same token: exactly one reset succeeds", async () => {
    const token = issuePasswordReset("editor@knowledgeai.dev")!;
    // resetPassword clears the token synchronously before its first await,
    // so the second invocation must lose the hash check - no double-consume.
    const [a, b] = await Promise.all([
      resetPassword(token, "firstpass1"),
      resetPassword(token, "secondpass2"),
    ]);
    const results = [a, b] as Array<{ ok?: boolean; error?: string }>;
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await verifyCredentials("editor@knowledgeai.dev", "firstpass1")).not.toBeNull();
    expect(await verifyCredentials("editor@knowledgeai.dev", "secondpass2")).toBeNull();
    expect(await consumePasswordReset(token)).toEqual({ error: RESET_ERROR_INVALID });
  });

  it("clears a brute-force login lockout", async () => {
    const email = "admin@knowledgeai.dev";
    await verifyCredentials(email, "wrong1");
    await verifyCredentials(email, "wrong2");
    await verifyCredentials(email, "wrong3");
    await verifyCredentials(email, "wrong4");
    await verifyCredentials(email, "wrong5");
    expect(isAccountLocked(email)).toBe(true);

    const token = issuePasswordReset(email)!;
    await resetPassword(token, "freshpass1");
    expect(isAccountLocked(email)).toBe(false);
    expect(await verifyCredentials(email, "freshpass1")).not.toBeNull();
  });
});