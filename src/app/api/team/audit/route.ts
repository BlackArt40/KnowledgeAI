import { NextResponse } from "next/server";
import { listAudit } from "@/lib/team/store";
export const dynamic = "force-dynamic";

// GET /api/team/audit
export async function GET() {
  return NextResponse.json({ audit: listAudit() });
}
