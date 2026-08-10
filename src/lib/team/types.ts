export type Role = "owner" | "admin" | "editor" | "viewer";
export type MemberStatus = "active" | "invited" | "suspended";
export type KbAccess = "view" | "edit" | "private";
/** P4-2: per-KB member role override (KB Owner / Editor / Viewer).
 *  Commenter is intentionally omitted - the system has no KB comment feature
 *  yet, so it would be indistinguishable from Viewer (read-only). */
export type KbMemberRole = "editor" | "viewer";

/** Document-level access (P4-2). Undefined = inherit the KB-level access. */
export type DocAccess = "view" | "edit" | "private";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: MemberStatus;
  lastActiveAt: number;
  joinedAt: number;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  createdAt: number;
}

export interface Team {
  id: string;
  name: string;
  logoInitial: string;
  plan: string;
  createdAt: number;
}

export interface KbAccessEntry {
  kbId: string;
  kbName: string;
  access: KbAccess;
  docs: number;
  ownerName: string;
  isOwner: boolean;
  /** P4-2: per-member roles on this KB (userId -> role). */
  memberRoles?: Record<string, KbMemberRole>;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_DESC: Record<Role, string> = {
  owner: "全部权限，含团队设置与计费",
  admin: "管理知识库与成员",
  editor: "编辑知识库与问答",
  viewer: "只读问答",
};

export const ACCESS_LABEL: Record<KbAccess, string> = {
  view: "全员可读",
  edit: "成员可编辑",
  private: "仅 Owner/Admin",
};

export const DOC_ACCESS_LABEL: Record<DocAccess, string> = {
  view: "仅查看",
  edit: "可编辑",
  private: "私有",
};

// Capability catalogue
export interface Permission {
  key: string;
  label: string;
}

export const PERMISSIONS: Permission[] = [
  { key: "kb.read", label: "查看知识库" },
  { key: "kb.create", label: "创建知识库" },
  { key: "kb.edit", label: "编辑知识库" },
  { key: "kb.delete", label: "删除知识库" },
  { key: "chat.use", label: "智能问答" },
  { key: "agent.run", label: "Agent 调研" },
  { key: "member.invite", label: "邀请成员" },
  { key: "member.manage", label: "管理成员" },
  { key: "team.settings", label: "团队设置" },
  { key: "billing.manage", label: "计费管理" },
];
