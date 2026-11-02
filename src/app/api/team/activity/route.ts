import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/guard";
import { findUserByEmail } from "@/lib/auth/store";
import { listAudit as listSecurityAudit } from "@/lib/security/audit";
import { can } from "@/lib/team/rbac";
import { listAudit as listTeamAudit, listMembers } from "@/lib/team/store";
import {
  activityToCsv,
  isActivityCategory,
  mergeActivity,
} from "@/lib/team/activity";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;
const EXPORT_LIMIT = 1000;
const MAX_QUERY = 120;

// GET /api/team/activity?category=&q=&before=&limit=&format=json|csv
//
// Unified team activity feed for managers: member/role changes (team audit)
// plus share-link and document-permission events (security audit). Security
// audit is global, so only events whose actor is a current team member are
// included; legacy rows without actorId fall back to the actor name.
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role, "member.manage")) {
    return NextResponse.json({ error: "权限不足" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const category = params.get("category")?.trim() || "all";
  if (category !== "all" && !isActivityCategory(category)) {
    return NextResponse.json({ error: "category 不合法" }, { status: 400 });
  }

  const q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY);

  const beforeRaw = params.get("before");
  let before: number | undefined;
  if (beforeRaw !== null && beforeRaw !== "") {
    const n = Number(beforeRaw);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "before 必须是时间戳" }, { status: 400 });
    }
    before = n;
  }

  const format = params.get("format") === "csv" ? "csv" : "json";
  const rawLimit = parseInt(params.get("limit") ?? "", 10);
  const maxLimit = format === "csv" ? EXPORT_LIMIT : MAX_LIMIT;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, maxLimit)
    : format === "csv"
      ? EXPORT_LIMIT
      : 50;

  const members = listMembers();
  const memberIds = new Set<string>([u.id]);
  const memberNames = new Set<string>();
  for (const m of members) {
    const account = findUserByEmail(m.email);
    if (account) memberIds.add(account.id);
    memberNames.add(m.name);
    memberNames.add(m.email);
  }
  const security = listSecurityAudit({ limit: 1000 }).audit.filter((ev) =>
    ev.actorId ? memberIds.has(ev.actorId) : memberNames.has(ev.actor)
  );

  const page = mergeActivity(listTeamAudit(), security, {
    category,
    q,
    before,
    limit,
  });

  if (format === "csv") {
    const filename = `team-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(activityToCsv(page.items), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(page);
}
