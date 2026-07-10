import { NextResponse } from "next/server";
import { listAudit } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { can } from "@/lib/team/rbac";
export const dynamic = "force-dynamic";

// GET /api/team/audit  (owner/admin only)
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role as never, "member.manage")) {
    return NextResponse.json({ error: "权限不足" }, { status: 403 });
  }
  return NextResponse.json({ audit: listAudit() });
}
