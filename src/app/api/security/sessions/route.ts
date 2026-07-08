import { NextResponse } from "next/server";
import { revokeAllSessions } from "@/lib/security/store";
export const dynamic = "force-dynamic";
export async function DELETE() {
  return NextResponse.json({ sessions: revokeAllSessions() });
}
