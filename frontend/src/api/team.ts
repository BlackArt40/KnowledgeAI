// 团队（P3-3 RBAC + P4-2 KB 成员角色）：GET /api/team 聚合、邀请、
// 成员角色变更/移除、KB 共享权限与成员级授权。
// permissions/matrix 由后端 RBAC 返回，前端不再硬编码角色判断。
import { apiUrl, request } from "./client";

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
  /** 仅管理者 / KB 所有者可见；其他角色为空对象。 */
  memberRoles: Record<string, string>;
  /** 成员级授权数量（所有人可见，不泄露具体邮箱）。 */
  memberRoleCount: number;
}

export interface TeamData {
  team: { id: string; name?: string; [key: string]: unknown };
  members: TeamMember[];
  stats: { total: number; active: number; invited: number; owners: number };
  sharedKbs: SharedKbRow[];
  audit: { id: string; action: string; actor: string; target?: string; createdAt: number; [key: string]: unknown }[];
  /** 当前用户的能力集（后端 ROLE_PERMS 投影）。 */
  permissions: string[];
  /** 角色 → 能力矩阵，权限矩阵表格直接渲染。 */
  matrix: Record<string, string[]>;
}

export async function fetchTeam(): Promise<TeamData> {
  return request<TeamData>("/api/team");
}

export async function inviteMember(
  email: string,
  role: string
): Promise<{ member?: TeamMember; emailSent?: boolean; inviteUrl?: string }> {
  return request("/api/team/invite", { method: "POST", body: { email, role } });
}

/** 接受邀请（签名 token，需登录且邮箱匹配）。 */
export async function acceptTeamInvite(token: string): Promise<unknown> {
  return request("/api/team/invite/accept", { method: "POST", body: { token } });
}

/** 拒绝邀请：移除 pending 成员行。 */
export async function rejectTeamInvite(token: string): Promise<unknown> {
  return request("/api/team/invite/reject", { method: "POST", body: { token } });
}

export function patchMemberRole(id: string, role: string): Promise<unknown> {
  return request(`/api/team/members/${encodeURIComponent(id)}`, { method: "PATCH", body: { role } });
}

export function removeMember(id: string): Promise<unknown> {
  return request(`/api/team/members/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 共享访问级别（view/edit/private）；管理者或 KB 所有者可调用。 */
export function patchKbAccess(kbId: string, access: string): Promise<unknown> {
  return request("/api/team/kb-access", { method: "PATCH", body: { kbId, access } });
}

/** 成员级授权（editor/viewer，null 清除）；仅 KB 所有者可调用。 */
export function setKbMemberRole(kbId: string, email: string, role: string | null): Promise<unknown> {
  return request("/api/team/kb-access", { method: "PATCH", body: { kbId, email, role } });
}

// ── 团队活动流（可观测与通知） ────────────────────────────────────────────

export type ActivityCategory =
  | "member"
  | "permission"
  | "share"
  | "content"
  | "team"
  | "security";

export interface TeamActivityItem {
  id: string;
  source: "team" | "security";
  category: ActivityCategory;
  action: string;
  actor: string;
  target: string;
  detail: string;
  createdAt: number;
}

export interface TeamActivityPage {
  items: TeamActivityItem[];
  total: number;
  counts: Record<ActivityCategory, number>;
  nextCursor?: number;
}

export interface TeamActivityQuery {
  category?: string;
  q?: string;
  before?: number;
  limit?: number;
}

function activityQuery(params: TeamActivityQuery, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams();
  if (params.category && params.category !== "all") qs.set("category", params.category);
  if (params.q?.trim()) qs.set("q", params.q.trim());
  if (params.before) qs.set("before", String(params.before));
  if (params.limit) qs.set("limit", String(params.limit));
  for (const [k, v] of Object.entries(extra)) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function fetchTeamActivity(params: TeamActivityQuery = {}): Promise<TeamActivityPage> {
  return request<TeamActivityPage>(`/api/team/activity${activityQuery(params)}`);
}

/** 下载 CSV（带 Cookie；文件名由前端生成，避免依赖响应头解析）。 */
export async function downloadTeamActivityCsv(params: TeamActivityQuery = {}): Promise<void> {
  const res = await fetch(apiUrl(`/api/team/activity${activityQuery(params, { format: "csv" })}`), {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CSV ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `team-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
