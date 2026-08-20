import type { Team, Member, AuditEntry, Role, KbAccess, KbMemberRole } from "./types";
import { persistTeam, persistAuditEntry, persistTeamMember, deleteTeamMemberFromDb } from "@/lib/db/persist";
import { getUserById } from "@/lib/auth/store";
import { uid } from "@/lib/ids";

type Store = {
  team: Team;
  members: Map<string, Member>;
  audit: AuditEntry[];
  kbAccess: Map<string, KbAccess>;
  /** P4-2: per-KB member role overrides (kbId -> userId -> role). */
  kbMemberRoles: Map<string, Record<string, KbMemberRole>>;
  seeded: boolean;
};

const g = globalThis as unknown as { __KAI_TEAM_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_TEAM_STORE__) {
    g.__KAI_TEAM_STORE__ = {
      team: { id: "team_default", name: "KnowledgeAI 团队", logoInitial: "K", plan: "专业版", createdAt: Date.now() - 1000 * 60 * 60 * 24 * 90 },
      members: new Map(),
      audit: [],
      kbAccess: new Map(),
      kbMemberRoles: new Map(),
      seeded: false,
    };
  } else {
    // HMR migration: stores created before P4-2 lack the per-KB role map.
    if (!g.__KAI_TEAM_STORE__.kbMemberRoles) g.__KAI_TEAM_STORE__.kbMemberRoles = new Map();
  }
  return g.__KAI_TEAM_STORE__;
}

// default access by KB name (applied when no explicit per-id access set)
const DEFAULT_ACCESS_BY_NAME: Record<string, KbAccess> = {
  "财务报告": "private",
  "运维手册": "edit",
  "HR 政策": "private",
};

function seed() {
  const s = store();
  if (s.seeded) return;
  s.seeded = true;
  const now = Date.now();
  const day = 1000 * 60 * 60 * 24;

  // First 4 members mirror the auth seed users (by email) so the team page
  // can correctly mark the logged-in user as "(你)". Extra members are demo data.
  const members: Array<Omit<Member, "id">> = [
    { name: "张明", email: "owner@knowledgeai.dev", role: "owner", status: "active", lastActiveAt: now - 1000 * 60 * 5, joinedAt: now - 90 * day },
    { name: "李芳", email: "admin@knowledgeai.dev", role: "admin", status: "active", lastActiveAt: now - 1000 * 60 * 60 * 2, joinedAt: now - 80 * day },
    { name: "王浩", email: "editor@knowledgeai.dev", role: "editor", status: "active", lastActiveAt: now - 1000 * 60 * 30, joinedAt: now - 60 * day },
    { name: "赵琳", email: "viewer@knowledgeai.dev", role: "viewer", status: "active", lastActiveAt: now - 2 * day, joinedAt: now - 30 * day },
    { name: "陈思雨", email: "chensiyu@knowledgeai.dev", role: "editor", status: "active", lastActiveAt: now - 1000 * 60 * 30, joinedAt: now - 60 * day },
    { name: "王浩然", email: "wanghaoran@knowledgeai.dev", role: "editor", status: "active", lastActiveAt: now - day, joinedAt: now - 45 * day },
    { name: "刘洋", email: "liuyang@knowledgeai.dev", role: "viewer", status: "active", lastActiveAt: now - 3 * day, joinedAt: now - 20 * day },
    { name: "张伟", email: "zhangwei@knowledgeai.dev", role: "viewer", status: "invited", lastActiveAt: now - 1000 * 60 * 60 * 6, joinedAt: now - 1000 * 60 * 60 * 6 },
  ];
  for (const m of members) {
    const member: Member = { ...m, id: uid("m") };
    s.members.set(member.id, member);
  }

  const audit: Array<Omit<AuditEntry, "id">> = [
    { actor: "王同学", action: "邀请成员", target: "张伟", detail: "以 Viewer 角色邀请加入团队", createdAt: now - 1000 * 60 * 60 * 6 },
    { actor: "李明轩", action: "创建知识库", target: "运维手册", detail: "新建知识库并上传 5 篇文档", createdAt: now - day },
    { actor: "陈思雨", action: "上传文档", target: "产品文档", detail: "上传 产品需求文档_v3.pdf", createdAt: now - 2 * day },
    { actor: "王同学", action: "修改角色", target: "王浩然", detail: "角色由 Viewer 调整为 Editor", createdAt: now - 5 * day },
    { actor: "李明轩", action: "运行调研", target: "Agent 调研", detail: "主题：竞品定价策略分析", createdAt: now - 6 * day },
    { actor: "陈思雨", action: "删除文档", target: "API 文档", detail: "删除旧版 openapi-v1.yaml", createdAt: now - 7 * day },
    { actor: "王同学", action: "团队设置", target: "团队信息", detail: "套餐升级为专业版", createdAt: now - 10 * day },
    { actor: "王同学", action: "创建团队", target: "KnowledgeAI 团队", detail: "创建团队并完成初始化", createdAt: now - 90 * day },
  ];
  for (const a of audit) s.audit.push({ ...a, id: uid("m") });
}

export function getTeam(): Team {
  seed();
  return store().team;
}

export function updateTeam(patch: Partial<Pick<Team, "name" | "logoInitial" | "plan">>): Team {
  seed();
  const s = store();
  s.team = { ...s.team, ...patch };
  void persistTeam({ ...s.team, kbAccess: Object.fromEntries(s.kbAccess), kbMemberRoles: Object.fromEntries(s.kbMemberRoles) });
  return s.team;
}

export function listMembers(): Member[] {
  seed();
  return Array.from(store().members.values()).sort((a, b) => b.joinedAt - a.joinedAt);
}

export function getMember(id: string): Member | undefined {
  seed();
  return store().members.get(id);
}

export function inviteMember(input: { name: string; email: string; role: Role }, actor = "系统"): Member {
  seed();
  const s = store();
  const member: Member = {
    id: uid("m"),
    name: input.name || input.email.split("@")[0],
    email: input.email,
    role: input.role,
    status: "invited",
    lastActiveAt: Date.now(),
    joinedAt: Date.now(),
  };
  s.members.set(member.id, member);
  const entry: AuditEntry = {
    id: uid("m"),
    actor,
    action: "邀请成员",
    target: member.name,
    detail: `以 ${member.role} 角色邀请加入团队`,
    createdAt: Date.now(),
  };
  s.audit.unshift(entry);
  void persistTeamMember(member);
  void persistAuditEntry(entry);
  return member;
}

export function updateMemberRole(id: string, role: Role, actor = "系统"): Member | undefined {
  seed();
  const s = store();
  const m = s.members.get(id);
  if (!m) return undefined;
  const prev = m.role;
  m.role = role;
  const entry: AuditEntry = {
    id: uid("m"),
    actor,
    action: "修改角色",
    target: m.name,
    detail: `角色由 ${prev} 调整为 ${role}`,
    createdAt: Date.now(),
  };
  s.audit.unshift(entry);
  void persistTeamMember(m);
  void persistAuditEntry(entry);
  return m;
}

export function removeMember(id: string, actor = "系统"): boolean {
  seed();
  const s = store();
  const m = s.members.get(id);
  if (!m) return false;
  const entry: AuditEntry = {
    id: uid("m"),
    actor,
    action: "移除成员",
    target: m.name,
    detail: `从团队移除 ${m.email}`,
    createdAt: Date.now(),
  };
  s.audit.unshift(entry);
  void persistAuditEntry(entry);
  void deleteTeamMemberFromDb(id);
  return s.members.delete(id);
}

export function listAudit(): AuditEntry[] {
  seed();
  return [...store().audit].sort((a, b) => b.createdAt - a.createdAt);
}

export function getKbAccess(kbId: string, kbName: string): KbAccess {
  seed();
  const s = store();
  return s.kbAccess.get(kbId) ?? DEFAULT_ACCESS_BY_NAME[kbName] ?? "view";
}

// ── P4-2: per-KB member roles ─────────────────────────────────────────────
// Keys are member EMAILS (stable, known to both the team panel and the auth
// layer; auth user ids are opaque to the team store).

/** The member's per-KB role override, or null when not set (inherit KB access). */
export function getKbMemberRole(kbId: string, email: string): KbMemberRole | null {
  seed();
  const roles = store().kbMemberRoles.get(kbId);
  return roles?.[email] ?? null;
}

/** Set/clear a member's role on a KB (P4-2). `null` removes the override. */
export function setKbMemberRole(kbId: string, email: string, role: KbMemberRole | null): void {
  seed();
  const s = store();
  const roles = s.kbMemberRoles.get(kbId) ?? {};
  if (role === null) {
    delete roles[email];
  } else {
    roles[email] = role;
  }
  if (Object.keys(roles).length === 0) s.kbMemberRoles.delete(kbId);
  else s.kbMemberRoles.set(kbId, roles);
  void persistTeam({ ...s.team, kbAccess: Object.fromEntries(s.kbAccess), kbMemberRoles: Object.fromEntries(s.kbMemberRoles) });
}

/** All per-KB member role overrides for a KB (keyed by email, team panel). */
export function listKbMemberRoles(kbId: string): Record<string, KbMemberRole> {
  seed();
  return { ...(store().kbMemberRoles.get(kbId) ?? {}) };
}

/** Access-check options (P1-1): when both are provided, the caller must be
 *  in the KB's workspace - a tenant-boundary check that closes the
 *  cross-workspace read/write hole in permission helpers. */
export interface KbAccessCheckOpts {
  /** The requesting user's resolved workspace (RequestUser.workspaceId). */
  callerWorkspaceId?: string;
  /** The KB's owning workspace (KnowledgeBase.workspaceId). */
  kbWorkspaceId?: string;
}

/** Can the user VIEW (read) this KB? Owner always; a per-KB role grants
 *  viewer/editor; otherwise falls back to the shared access (P4-2).
 *  P1-1: when callerWorkspaceId + kbWorkspaceId are supplied, a mismatch
 *  denies access outright (cross-tenant isolation). */
export function canViewKb(
  kbId: string,
  kbName: string,
  userId: string,
  ownerId: string,
  opts?: KbAccessCheckOpts
): boolean {
  if (opts?.callerWorkspaceId !== undefined && opts.kbWorkspaceId !== undefined &&
      opts.callerWorkspaceId !== opts.kbWorkspaceId) {
    return false;
  }
  if (ownerId === userId) return true;
  const user = getUserById(userId);
  const role = user ? getKbMemberRole(kbId, user.email) : null;
  if (role) return true; // viewer or editor override
  return getKbAccess(kbId, kbName) !== "private";
}

/** Can the user EDIT (upload/modify) this KB? Owner always; per-KB editor
 *  role grants edit; otherwise only when the shared access is "edit".
 *  P1-1: workspace mismatch denies access (see canViewKb). */
export function canEditKb(
  kbId: string,
  kbName: string,
  userId: string,
  ownerId: string,
  opts?: KbAccessCheckOpts
): boolean {
  if (opts?.callerWorkspaceId !== undefined && opts.kbWorkspaceId !== undefined &&
      opts.callerWorkspaceId !== opts.kbWorkspaceId) {
    return false;
  }
  if (ownerId === userId) return true;
  const user = getUserById(userId);
  const role = user ? getKbMemberRole(kbId, user.email) : null;
  if (role === "editor") return true;
  return getKbAccess(kbId, kbName) === "edit";
}

export function setKbAccess(kbId: string, access: KbAccess): void {
  seed();
  const s = store();
  s.kbAccess.set(kbId, access);
  void persistTeam({ ...s.team, kbAccess: Object.fromEntries(s.kbAccess), kbMemberRoles: Object.fromEntries(s.kbMemberRoles) });
}
