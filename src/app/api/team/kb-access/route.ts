import { NextResponse } from "next/server";
import { setKbAccess } from "@/lib/team/store";
import { getRequestUser } from "@/lib/auth/guard";
import { can } from "@/lib/team/rbac";
import type { KbAccess } from "@/lib/team/types";

export const dynamic = "force-dynamic";

// PATCH /api/team/kb-access  { kbId, access }  (owner/admin only)
export async function PATCH(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!can(u.role as never, "member.manage")) {
    return NextResponse.json({ error: "权限不足：仅 Owner/Admin 可调整共享权限" }, { status: 403 });
  }

  let body: { kbId?: string; access?: KbAccess };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.kbId || !body.access) {
    return NextResponse.json({ error: "kbId 与 access 必填" }, { status: 400 });
  }
  setKbAccess(body.kbId, body.access);
  return NextResponse.json({ ok: true });
}
