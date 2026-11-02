// ---------------------------------------------------------------------------
// Team activity feed (2026-11)
//
// Observability for the collaboration surface: the team store keeps display
// audit entries (members / roles / shared KB access), while the security audit
// trail keeps hash-chained events (share links / document permissions). The
// team page used to show only the former, so public-sharing and document-level
// permission changes were invisible there.
//
// This module maps both sources onto one typed item, filters by category/text,
// paginates by timestamp, and renders CSV. It is deliberately pure so the
// route only resolves identities and permissions.
// ---------------------------------------------------------------------------

import type { AuditEvent } from "@/lib/security/audit";
import type { AuditEntry } from "./types";

export type ActivityCategory =
  | "member"
  | "permission"
  | "share"
  | "content"
  | "team"
  | "security";

export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = [
  "member",
  "permission",
  "share",
  "content",
  "team",
  "security",
];

export interface ActivityItem {
  id: string;
  source: "team" | "security";
  category: ActivityCategory;
  action: string;
  actor: string;
  target: string;
  detail: string;
  createdAt: number;
}

export interface ActivityFilter {
  category?: string;
  q?: string;
  before?: number;
  limit?: number;
}

export interface ActivityPage {
  items: ActivityItem[];
  total: number;
  counts: Record<ActivityCategory, number>;
  nextCursor?: number;
}

const TEAM_ACTION_CATEGORY: Record<string, ActivityCategory> = {
  邀请成员: "member",
  移除成员: "member",
  修改角色: "permission",
  团队设置: "team",
  创建团队: "team",
  创建知识库: "content",
  上传文档: "content",
  删除文档: "content",
  运行调研: "content",
};

const SECURITY_ACTION_CATEGORY: Record<string, ActivityCategory> = {
  "member.invite": "member",
  "member.remove": "member",
  "member.role_change": "permission",
  "kb.access_change": "permission",
  "doc.access_change": "permission",
  "sharelink.create": "share",
  "sharelink.revoke": "share",
  "doc.delete": "content",
  "team.settings": "team",
};

/** Category for one action string. Unknown codes fall back by prefix so newly
 *  added audit actions stay visible instead of being dropped. */
export function categorizeAction(
  source: "team" | "security",
  action: string
): ActivityCategory {
  const table = source === "team" ? TEAM_ACTION_CATEGORY : SECURITY_ACTION_CATEGORY;
  const known = table[action];
  if (known) return known;
  if (action.startsWith("sharelink.")) return "share";
  if (action.startsWith("member.") || action.startsWith("invite.")) return "member";
  if (action.startsWith("kb.") || action.startsWith("doc.")) return "permission";
  if (action.startsWith("team.")) return "team";
  if (action.startsWith("auth.") || action.startsWith("login.")) return "security";
  return source === "team" ? "team" : "security";
}

export function isActivityCategory(value: string): value is ActivityCategory {
  return (ACTIVITY_CATEGORIES as readonly string[]).includes(value);
}

export function teamAuditToActivity(entry: AuditEntry): ActivityItem {
  return {
    id: entry.id,
    source: "team",
    category: categorizeAction("team", entry.action),
    action: entry.action,
    actor: entry.actor,
    target: entry.target,
    detail: entry.detail,
    createdAt: entry.createdAt,
  };
}

export function securityAuditToActivity(event: AuditEvent): ActivityItem {
  return {
    id: event.id,
    source: "security",
    category: categorizeAction("security", event.action),
    action: event.action,
    actor: event.actor,
    target: event.target,
    detail: event.detail,
    createdAt: event.createdAt,
  };
}

function matchesQuery(item: ActivityItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [item.actor, item.target, item.action, item.detail]
    .join("\n")
    .toLowerCase()
    .includes(needle);
}

function emptyCounts(): Record<ActivityCategory, number> {
  return {
    member: 0,
    permission: 0,
    share: 0,
    content: 0,
    team: 0,
    security: 0,
  };
}

/** Merge both audit sources, then filter / sort / paginate. */
export function mergeActivity(
  teamAudit: AuditEntry[],
  securityAudit: AuditEvent[],
  filter: ActivityFilter = {}
): ActivityPage {
  const seen = new Set<string>();
  const merged: ActivityItem[] = [];
  for (const item of [
    ...teamAudit.map(teamAuditToActivity),
    ...securityAudit.map(securityAuditToActivity),
  ]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  merged.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  // Counts describe the search (q) across all categories, not the active
  // filter or the current page - loading older pages must not shrink chips.
  const searched = merged.filter((item) => matchesQuery(item, filter.q ?? ""));
  const counts = emptyCounts();
  for (const item of searched) counts[item.category] += 1;

  const category = filter.category && filter.category !== "all" ? filter.category : "";
  const filtered = category
    ? searched.filter((item) => item.category === category)
    : searched;
  const windowed = filtered.filter(
    (item) => filter.before === undefined || item.createdAt < filter.before
  );

  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 1000);
  const items = windowed.slice(0, limit);
  const nextCursor =
    items.length === limit && windowed.length > limit
      ? items[items.length - 1].createdAt
      : undefined;

  return { items, total: filtered.length, counts, nextCursor };
}

function csvCell(value: string): string {
  // Formula-injection guard: Excel executes cells starting with these chars
  // even when quoted, so prefix a literal apostrophe.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV export with a UTF-8 BOM so Excel opens Chinese text correctly. */
export function activityToCsv(items: ActivityItem[]): string {
  const rows = [
    ["时间", "类别", "操作", "操作者", "对象", "详情"],
    ...items.map((item) => [
      new Date(item.createdAt).toISOString(),
      item.category,
      item.action,
      item.actor,
      item.target,
      item.detail,
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
