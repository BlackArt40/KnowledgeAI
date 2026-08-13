// ---------------------------------------------------------------------------
// OAuth link management (P3-2) - maps provider identities (Google / GitHub)
// to local user accounts.
//
// Responsibilities:
//   - upsertOauthUser: OAuth login entry point. Resolves a provider identity
//     to a local user by: 1) existing provider link, 2) matching email
//     (账号关联 - first OAuth login binds to the existing account),
//     3) auto-creating a passwordless user.
//   - linkOauthToUser: bind a provider to the CURRENTLY logged-in user
//     (settings page "绑定" - the OAuth identity becomes an additional
//     login method, no session switch).
//   - unlinkOauthProvider: remove a provider link; a user must keep at least
//     one login method (a password or another provider).
//
// The link map is stored on User.oauthLinks (provider -> providerAccountId)
// in memory + persisted via persistUser (Prisma JSONB column, migration
// p3_2_oauth_links). OAuth-only accounts keep passwordHash null.
// ---------------------------------------------------------------------------

import { listUsers, findUserByEmail, createOAuthUser, type User } from "@/lib/auth/store";
import { persistUser } from "@/lib/db/persist";

/** Supported OAuth providers (keep in sync with authjs.ts providers). */
export const OAUTH_PROVIDERS = ["google", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Normalized identity returned by the OAuth bridge (from the Auth.js
 *  session, which carries the provider + providerAccountId claims). */
export interface OAuthProfile {
  provider: OAuthProvider;
  providerUserId: string;
  email: string;
  name: string;
}

export function isOAuthProvider(p: string): p is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(p);
}

/** The linked provider account id for a user, or undefined. */
export function getOauthLink(user: User, provider: string): string | undefined {
  return user.oauthLinks?.[provider];
}

/** All provider links of a user (safe map, no secrets). */
export function listOauthLinks(user: User): Record<string, string> {
  return { ...(user.oauthLinks ?? {}) };
}

function findUserByProvider(provider: string, providerUserId: string): User | null {
  return listUsers().find((u) => u.oauthLinks?.[provider] === providerUserId) ?? null;
}

/** OAuth login resolution: existing link -> email match (bind) -> auto-create.
 *  Returns the resolved user (with `created` flag) or a { error } message. */
export async function upsertOauthUser(
  profile: OAuthProfile
): Promise<{ user: User; created: boolean } | { error: string }> {
  if (!isOAuthProvider(profile.provider)) return { error: "不支持的登录方式" };
  if (!profile.email) return { error: "该社交账号未提供邮箱" };

  // 1. Already linked to an account -> plain login.
  const byProvider = findUserByProvider(profile.provider, profile.providerUserId);
  if (byProvider) return { user: byProvider, created: false };

  // 2. Email matches an existing account -> link the provider to it
  //    (首次 OAuth 登录自动关联同名邮箱账号).
  const byEmail = findUserByEmail(profile.email);
  if (byEmail) {
    byEmail.oauthLinks = { ...(byEmail.oauthLinks ?? {}), [profile.provider]: profile.providerUserId };
    void persistUser(byEmail);
    return { user: byEmail, created: false };
  }

  // 3. New identity -> auto-create a passwordless account.
  const created = await createOAuthUser(
    profile.name || profile.email.split("@")[0],
    profile.email,
    profile.provider,
    profile.providerUserId
  );
  if ("error" in created) return { error: created.error };
  return { user: created, created: true };
}

/** Bind an OAuth identity to the currently logged-in user (settings page
 *  "绑定" - keeps the existing session; the provider becomes an additional
 *  login method). Conflicts: the provider already linked elsewhere, or the
 *  profile email belongs to a different account. */
export async function linkOauthToUser(
  target: User,
  profile: OAuthProfile
): Promise<{ user: User } | { error: string }> {
  if (!isOAuthProvider(profile.provider)) return { error: "不支持的登录方式" };
  if (!profile.email) return { error: "该社交账号未提供邮箱" };

  const other = findUserByProvider(profile.provider, profile.providerUserId);
  if (other && other.id !== target.id) return { error: "该社交账号已绑定其他用户" };

  const byEmail = findUserByEmail(profile.email);
  if (byEmail && byEmail.id !== target.id) return { error: "该社交账号的邮箱已被其他账号使用" };

  target.oauthLinks = { ...(target.oauthLinks ?? {}), [profile.provider]: profile.providerUserId };
  void persistUser(target);
  return { user: target };
}

/** Remove a provider link. Refuses when it would leave the account with no
 *  login method at all (no password and no other provider). */
export async function unlinkOauthProvider(
  user: User,
  provider: string
): Promise<{ user: User } | { error: string }> {
  if (!isOAuthProvider(provider)) return { error: "不支持的登录方式" };
  if (!user.oauthLinks?.[provider]) return { error: "该账号未绑定此登录方式" };

  const remaining = Object.keys(user.oauthLinks).filter((p) => p !== provider);
  if (remaining.length === 0 && !user.passwordHash) {
    return { error: "至少保留一种登录方式（密码或其他社交账号）" };
  }

  const next = { ...user.oauthLinks };
  delete next[provider];
  user.oauthLinks = next;
  void persistUser(user);
  return { user };
}
