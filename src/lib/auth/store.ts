// ---------------------------------------------------------------------------
// User Store - user accounts with role-based access.
// Seeds 4 demo users (one per role) for testing different permission levels.
// 🔌 Production: replace with Prisma queries (see src/lib/db/repository.ts)
// ---------------------------------------------------------------------------

import crypto from "crypto";
import type { Role } from "@/lib/team/types";
import { ROLE_LABEL, ROLE_DESC } from "@/lib/team/types";

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  plan: "free" | "pro" | "enterprise";
  createdAt: number;
  lastLoginAt: number | null;
}

// Demo password for all seed accounts
export const DEMO_PASSWORD = "password123";

function hashPwd(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
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
  { email: "owner@knowledgeai.dev", name: "张明（Owner）", role: "owner", plan: "enterprise" },
  { email: "admin@knowledgeai.dev", name: "李芳（Admin）", role: "admin", plan: "pro" },
  { email: "editor@knowledgeai.dev", name: "王浩（Editor）", role: "editor", plan: "pro" },
  { email: "viewer@knowledgeai.dev", name: "赵琳（Viewer）", role: "viewer", plan: "free" },
];

export function seed() {
  const s = store();
  if (s.seeded) return;
  s.seeded = true;
  const now = Date.now();
  const pwdHash = hashPwd(DEMO_PASSWORD);
  for (const u of SEED_USERS) {
    const user: User = {
      ...u,
      id: `usr_${u.email.split("@")[0]}`,
      passwordHash: pwdHash,
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

export function verifyCredentials(email: string, password: string): User | null {
  const user = findUserByEmail(email);
  if (!user) return null;
  if (user.passwordHash !== hashPwd(password)) return null;
  // update last login
  user.lastLoginAt = Date.now();
  return user;
}

export function createUser(name: string, email: string, password: string, role: Role = "editor"): User | { error: string } {
  seed();
  const s = store();
  if (s.emailIndex.has(email.toLowerCase())) {
    return { error: "该邮箱已被注册" };
  }
  const user: User = {
    id: uid("usr"),
    name,
    email,
    passwordHash: hashPwd(password),
    role,
    plan: "free",
    createdAt: Date.now(),
    lastLoginAt: null,
  };
  s.users.set(user.id, user);
  s.emailIndex.set(email.toLowerCase(), user.id);
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
}

/** Update a user's profile (name) and/or password.
 *  Password change requires verifying the current password. */
export function updateUser(
  userId: string,
  input: UpdateUserInput
): User | { error: string } {
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
    if (!input.currentPassword) return { error: "修改密码需提供当前密码" };
    if (user.passwordHash !== hashPwd(input.currentPassword)) {
      return { error: "当前密码不正确" };
    }
    if (input.newPassword.length < 8) return { error: "新密码至少 8 位" };
    user.passwordHash = hashPwd(input.newPassword);
  }

  s.users.set(user.id, user);
  return user;
}

// Strip sensitive fields for API responses
export function sanitize(user: User): Omit<User, "passwordHash"> {
  const { passwordHash, ...rest } = user;
  return rest;
}

export { ROLE_LABEL, ROLE_DESC };
