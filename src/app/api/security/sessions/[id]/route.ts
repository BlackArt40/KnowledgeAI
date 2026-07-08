import { NextResponse } from "next/server";
import { revokeSession } from "@/lib/security/store";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  return NextResponse.json({ sessions: revokeSession(id) });
}
