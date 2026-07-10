import { NextResponse } from "next/server";
import { getSecurity, ensureCurrentSession, runRetentionCleanup } from "@/lib/security/store";
import { clientInfoFromRequest } from "@/lib/security/ua";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  // Make sure the current browser session is represented even if the
  // in-memory store was reset (e.g. dev server restart).
  ensureCurrentSession(u.id, clientInfoFromRequest(req));
  // Run data-retention cleanup: delete conversations and login history
  // older than the user's configured retention period.
  runRetentionCleanup(u.id);
  return NextResponse.json(getSecurity(u.id));
}
