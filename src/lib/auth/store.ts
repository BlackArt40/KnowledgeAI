// ---------------------------------------------------------------------------
// User Store - user accounts with role-based access.
// Seeds 4 demo users (one per role) for testing different permission levels.
// 🔌 Production: replace with Prisma queries (see src/lib/db/repository.ts)
// ---------------------------------------------------------------------------

import crypto from "crypto";
import type { Role } from "@/lib/roles";
import { persistUser } from "@/lib/db/persist";
import { hashPassword, verifyPassword } from "@/lib/auth/session";
import { ROLE_LABEL, ROLE_DESC } from "@/lib/roles";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  role: Role;
  plan: "free" | "pro" | "enterprise";
  status: "active" | "banned";
  createdAt: number;
  lastLoginAt: number | null;
  /** P5-4: preferred UI language ("zh-CN" | "en"), persisted to the DB. */
  locale?: string;
  /** P3-2: OAuth provider links (provider -> providerAccountId), e.g.
   *  { google: "1177...", github: "4821..." }. OAuth-only accounts have
   *  passwordHash null. Persisted via persistUser / hydrateUser. */
  oauthLinks?: Record<string, string>;
}

// Demo password for all seed accounts
export const DEMO_PASSWORD = "password123";

// Legacy password hash (pre-P3-4): unsalted SHA-256, kept ONLY for seed
// accounts and compatibility verification. New hashes use PBKDF2-100k via
// auth/session.ts (hashPassword / verifyPassword).
function legacyHash(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

/** Check a password against a stored hash. Supports PBKDF2 (`pbkdf2$...`)
 *  and legacy SHA-256 hex hashes (seed accounts / pre-P3-4 rows). */
async function passwordMatches(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith("pbkdf2$")) return verifyPassword(password, stored);
  return stored === legacyHash(password);
}

function uid(p: string) {
  return `${p}_${Math.random().toString(36).slice(2, 10)}`;
}

type Store = { users: Map<string, User>; emailIndex: Map<string, string>; seeded: boolean };
const g = globalThis as unknown as { __KAI_USER_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_USER_STORE__) {
    g.__KAI_USER_STORE__ = { users: new Map(), emailIndex: new Map(), seeded: false };
  }
  return g.__KAI_USER_STORE__;
}

const SEED_USERS: Omit<User, "id" | "passwordHash" | "createdAt" | "lastLoginAt">[] = [
  { email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "owner", plan: "enterprise", status: "active" },
  { email: "admin@knowledgeai.dev", name: "李芳（Admin）", role: "admin", plan: "pro", status: "active" },
  { email: "editor@knowledgeai.dev", name: "王浩（Editor）", role: "editor", plan: "pro", status: "active" },
  { email: "viewer@knowledgeai.dev", name: "赵琳（Viewer）", role: "viewer", plan: "free", status: "active" },
];

export function seed() {
  const s = store();
  if (s.seeded) return;
  s.seeded = true;
  const now = Date.now();
  const pwdHash = legacyHash(DEMO_PASSWORD);
  for (const u of SEED_USERS) {
    const user: User = {
      ...u,
      id: `usr_${u.email.split("@")[0]}`,
      passwordHash: pwdHash,
      status: "active",
      createdAt: now - 30 * 86400000,
      lastLoginAt: null,
    };
    s.users.set(user.id, user);
    s.emailIndex.set(user.email.toLowerCase(), user.id);
  }
}

export function findUserByEmail(email: string): User | null {
  seed();
  const id = store().emailIndex.get(email.toLowerCase());
  return id ? store().users.get(id) ?? null : null;
}

export function getUserById(id: string): User | null {
  seed();
  return store().users.get(id) ?? null;
}

export async function verifyCredentials(email: string, password: string): Promise<User | null> {
  const user = findUserByEmail(email);
  if (!user) return null;
  // OAuth-only accounts have no password - they can't use password login.
  const hash = user.passwordHash;
  if (!hash) return null;
  if (!(await passwordMatches(password, hash))) return null;
  // P3-4: migrate legacy SHA-256 hashes to PBKDF2 on successful login.
  if (!hash.startsWith("pbkdf2$")) {
    user.passwordHash = await hashPassword(password);
    void persistUser(user);
  }
  // update last login
  user.lastLoginAt = Date.now();
  return user;
}

export async function createUser(name: string, email: string, password: string, role: Role = "editor"): Promise<User | { error: string }> {
  seed();
  const s = store();
  if (s.emailIndex.has(email.toLowerCase())) {
    return { error: "该邮箱已被注册" };
  }
  const user: User = {
    id: uid("usr"),
    name,
    email,
    passwordHash: await hashPassword(password),
    role,
    plan: "free",
    status: "active",
    createdAt: Date.now(),
    lastLoginAt: null,
  };
  s.users.set(user.id, user);
  s.emailIndex.set(email.toLowerCase(), user.id);
  void persistUser(user);
  return user;
}

/** P3-2: create a passwordless user from an OAuth identity (Google/GitHub).
 *  `passwordHash` stays null; login is only possible via the linked provider
 *  (or by setting a password later through the profile settings). */
export async function createOAuthUser(
  name: string,
  email: string,
  provider: string,
  providerUserId: string
): Promise<User | { error: string }> {
  seed();
  const s = store();
  if (s.emailIndex.has(email.toLowerCase())) {
    return { error: "该邮箱已被注册" };
  }
  const user: User = {
    id: uid("usr"),
    name,
    email,
    passwordHash: null,
    role: "editor",
    plan: "free",
    status: "active",
    createdAt: Date.now(),
    lastLoginAt: null,
    oauthLinks: { [provider]: providerUserId },
  };
  s.users.set(user.id, user);
  s.emailIndex.set(email.toLowerCase(), user.id);
  void persistUser(user);
  return user;
}

export function listUsers(): User[] {
  seed();
  return [...store().users.values()].sort((a, b) => a.createdAt - b.createdAt);
}


export interface UpdateUserInput {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
  /** P5-4: preferred UI language ("zh-CN" | "en"). */
  locale?: string;
}

/** Update a user's profile (name) and/or password.
 *  Password change requires verifying the current password. */
export async function updateUser(
  userId: string,
  input: UpdateUserInput
): Promise<User | { error: string }> {
  seed();
  const s = store();
  const user = s.users.get(userId);
  if (!user) return { error: "用户不存在" };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { error: "姓名不能为空" };
    user.name = name;
  }

  if (input.newPassword) {
    // P3-2: OAuth-only accounts have no password yet - setting one does not
    // require a current password (it's an initial password, not a change).
    const current = input.currentPassword;
    if (user.passwordHash) {
      if (!current) return { error: "修改密码需提供当前密码" };
      if (!(await passwordMatches(current, user.passwordHash))) {
        return { error: "当前密码不正确" };
      }
    }
    if (input.newPassword.length < 8) return { error: "新密码至少 8 位" };
    user.passwordHash = await hashPassword(input.newPassword);
  }

  if (input.locale !== undefined) {
    if (input.locale !== "zh-CN" && input.locale !== "en") return { error: "不支持的语言" };
    user.locale = input.locale;
  }

  s.users.set(user.id, user);
  void persistUser(user);
  return user;
}

/** Admin: set a user's status (active/banned). */
export function setUserStatus(userId: string, status: "active" | "banned"): User | null {
  seed();
  const s = store();
  const u = s.users.get(userId);
  if (!u) return null;
  u.status = status;
  void persistUser(u);
  return u;
}

/** Billing: upgrade/downgrade a user's plan after payment. */
export function updateUserPlan(userId: string, plan: "free" | "pro" | "enterprise"): User | null {
  seed();
  const s = store();
  const u = s.users.get(userId);
  if (!u) return null;
  u.plan = plan;
  void persistUser(u);
  return u;
}

/** Account deletion: remove user from auth store. */
export function deleteUser(userId: string): boolean {
  seed();
  const s = store();
  const u = s.users.get(userId);
  if (!u) return false;
  s.emailIndex.delete(u.email.toLowerCase());
  s.users.delete(userId);
  return true;
}

// Strip sensitive fields for API responses
export function sanitize(user: User): Omit<User, "passwordHash"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = user;
  return rest;
}

export { ROLE_LABEL, ROLE_DESC };
