// 团队（P3-3 RBAC + P4-2 KB 成员角色）：GET /api/team 聚合、邀请、
// 成员角色变更/移除。audit 仅 owner/admin 返回。
import { request } from "./client";

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  [key: string]: unknown;
}

export interface SharedKbRow {
  kbId: string;
  kbName: string;
  access: string;
  docs: number;
  ownerName: string;
  isOwner: boolean;
  memberRoles: Record<string, string>;
}

export interface TeamData {
  team: { id: string; name?: string; [key: string]: unknown };
  members: TeamMember[];
  stats: { total: number; active: number; invited: number; owners: number };
  sharedKbs: SharedKbRow[];
  audit: { id: string; action: string; actor: string; target?: string; createdAt: number; [key: string]: unknown }[];
}

export async function fetchTeam(): Promise<TeamData> {
  return request<TeamData>("/api/team");
}

export async function inviteMember(email: string, role: string): Promise<unknown> {
  return request("/api/team/invite", { method: "POST", body: { email, role } });
}

export function patchMemberRole(id: string, role: string): Promise<unknown> {
  return request(`/api/team/members/${encodeURIComponent(id)}`, { method: "PATCH", body: { role } });
}

export function removeMember(id: string): Promise<unknown> {
  return request(`/api/team/members/${encodeURIComponent(id)}`, { method: "DELETE" });
}
