import { NextResponse } from "next/server";
import { markRead } from "@/lib/notifications/store";
export const dynamic = "force-dynamic";

// PATCH /api/notifications/[id]/read - mark a single notification as read
export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  markRead(id);
  return NextResponse.json({ ok: true });
}
