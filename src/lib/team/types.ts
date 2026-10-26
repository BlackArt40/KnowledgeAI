import type { Role } from "@/lib/roles";
export type { Role };
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


