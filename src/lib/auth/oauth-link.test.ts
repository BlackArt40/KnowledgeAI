// P3-2 unit tests: OAuth link management (upsert / link / unlink).
import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertOauthUser,
  linkOauthToUser,
  unlinkOauthProvider,
  listOauthLinks,
  getOauthLink,
  isOAuthProvider,
} from "./oauth-link";
import { createUser, createOAuthUser, findUserByEmail, getUserById, listUsers } from "./store";

// The user store is globalThis-backed; reset it between tests so cases start
// from a clean seed (demo users only).
function resetUserStore() {
  const g = globalThis as unknown as {
    __KAI_USER_STORE__?: { users: Map<string, unknown>; emailIndex: Map<string, string>; seeded: boolean };
  };
  delete g.__KAI_USER_STORE__;
}

const googleProfile = {
  provider: "google",
  providerUserId: "google-123",
  email: "google.user@example.com",
  name: "Google User",
} as const;

beforeEach(() => {
  resetUserStore();
});

describe("upsertOauthUser", () => {
  it("auto-creates a passwordless user for a new identity", async () => {
    const r = await upsertOauthUser(googleProfile);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.created).toBe(true);
    expect(r.user.passwordHash).toBeNull();
    expect(r.user.role).toBe("editor");
    expect(r.user.oauthLinks).toEqual({ google: "google-123" });
    // login-able via the provider link
    const again = await upsertOauthUser(googleProfile);
    expect("error" in again).toBe(false);
    if ("error" in again) return;
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(r.user.id);
  });

  it("links to an existing account with the same email (首次 OAuth 登录自动关联)", async () => {
    const created = await createUser("同名用户", "google.user@example.com", "password123", "editor");
    expect("error" in created).toBe(false);
    if ("error" in created) return;

    const r = await upsertOauthUser(googleProfile);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.created).toBe(false);
    expect(r.user.id).toBe(created.id);
    expect(r.user.oauthLinks).toEqual({ google: "google-123" });
    expect(r.user.passwordHash).not.toBeNull(); // password still usable
  });

  it("rejects unknown providers", async () => {
    const r = await upsertOauthUser({ ...googleProfile, provider: "x" as never });
    expect("error" in r).toBe(true);
  });

  it("rejects missing email", async () => {
    const r = await upsertOauthUser({ ...googleProfile, email: "" });
    expect("error" in r).toBe(true);
  });
});

describe("createOAuthUser", () => {
  it("creates a user with the provider link and no password", async () => {
    const u = await createOAuthUser("GitHub 用户", "gh@example.com", "github", "gh-42");
    expect("error" in u).toBe(false);
    if ("error" in u) return;
    expect(u.passwordHash).toBeNull();
    expect(u.oauthLinks).toEqual({ github: "gh-42" });
    expect(findUserByEmail("gh@example.com")?.id).toBe(u.id);
  });

  it("rejects a duplicate email", async () => {
    await createOAuthUser("A", "dup@example.com", "google", "g-1");
    const r = await createOAuthUser("B", "dup@example.com", "github", "g-2");
    expect("error" in r).toBe(true);
  });
});

describe("linkOauthToUser (bind mode)", () => {
  it("binds a new provider to the current user", async () => {
    const created = await createUser("绑定用户", "bind@example.com", "password123", "editor");
    expect("error" in created).toBe(false);
    if ("error" in created) return;

    const r = await linkOauthToUser(created, googleProfile);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.user.oauthLinks).toEqual({ google: "google-123" });
    expect(getOauthLink(r.user, "google")).toBe("google-123");
  });

  it("rejects when the provider is already linked to another user", async () => {
    await upsertOauthUser(googleProfile); // google-123 -> auto-created user
    const target = await createUser("第三人", "third@example.com", "password123", "editor");
    expect("error" in target).toBe(false);
    if ("error" in target) return;

    const r = await linkOauthToUser(target, googleProfile);
    expect("error" in r).toBe(true);
  });

  it("rejects when the profile email belongs to another account", async () => {
    await createUser("邮箱主人", googleProfile.email, "password123", "editor");
    const target = await createUser("绑定者", "other@example.com", "password123", "editor");
    expect("error" in target).toBe(false);
    if ("error" in target) return;

    const r = await linkOauthToUser(target, googleProfile);
    expect("error" in r).toBe(true);
    expect(target.oauthLinks).toBeUndefined();
  });

  it("allows binding a provider whose email matches the SAME user", async () => {
    const target = await createUser("本人", googleProfile.email, "password123", "editor");
    expect("error" in target).toBe(false);
    if ("error" in target) return;
    const r = await linkOauthToUser(target, googleProfile);
    expect("error" in r).toBe(false);
  });
});

describe("unlinkOauthProvider", () => {
  it("removes a provider link and persists the rest", async () => {
    const u = await createOAuthUser("双绑定", "dual@example.com", "google", "g-1");
    expect("error" in u).toBe(false);
    if ("error" in u) return;
    const linked = await linkOauthToUser(u, { ...googleProfile, provider: "github", providerUserId: "gh-1", email: "dual@example.com" });
    expect("error" in linked).toBe(false);
    if ("error" in linked) return;
    expect(Object.keys(listOauthLinks(linked.user)).sort()).toEqual(["github", "google"]);

    const r = await unlinkOauthProvider(linked.user, "google");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.user.oauthLinks).toEqual({ github: "gh-1" });
  });

  it("refuses to unlink the last login method (OAuth-only user)", async () => {
    const u = await createOAuthUser("仅 OAuth", "only@example.com", "google", "g-1");
    expect("error" in u).toBe(false);
    if ("error" in u) return;
    const r = await unlinkOauthProvider(u, "google");
    expect("error" in r).toBe(true);
    expect(getOauthLink(u, "google")).toBe("g-1");
  });

  it("allows unlinking when a password exists", async () => {
    const u = await createUser("密码用户", "pw@example.com", "password123", "editor");
    expect("error" in u).toBe(false);
    if ("error" in u) return;
    await linkOauthToUser(u, googleProfile);
    const r = await unlinkOauthProvider(u, "google");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.user.oauthLinks).toEqual({});
  });

  it("rejects unknown provider / not-linked provider", async () => {
    const u = await createUser("常规", "plain@example.com", "password123", "editor");
    expect("error" in u).toBe(false);
    if ("error" in u) return;
    expect("error" in (await unlinkOauthProvider(u, "wechat"))).toBe(true);
    expect("error" in (await unlinkOauthProvider(u, "google"))).toBe(true);
  });
});

describe("helpers", () => {
  it("isOAuthProvider", () => {
    expect(isOAuthProvider("google")).toBe(true);
    expect(isOAuthProvider("github")).toBe(true);
    expect(isOAuthProvider("gitlab")).toBe(false);
  });

  it("listOauthLinks never returns the internal reference", () => {
    const user = listUsers()[0];
    const links = listOauthLinks(user);
    links.google = "hacked";
    expect(user.oauthLinks).toBeUndefined();
  });

  it("getUserById still resolves after OAuth flows", async () => {
    const r = await upsertOauthUser(googleProfile);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(getUserById(r.user.id)?.email).toBe(googleProfile.email);
  });
});
