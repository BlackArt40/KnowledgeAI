import { NextResponse } from "next/server";
import { getOverview } from "@/lib/admin/store";
import { requireRole } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const guard = await requireRole(req, ["owner", "admin"]);
  if (guard.error) return guard.error;
  return NextResponse.json(getOverview());
}
