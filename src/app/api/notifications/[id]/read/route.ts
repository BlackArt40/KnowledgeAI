import { NextResponse } from "next/server";
import { markRead } from "@/lib/notifications/store";
import { getRequestUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

// PATCH /api/notifications/[id]/read - mark a single notification as read
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  markRead(u.id, id);
  return NextResponse.json({ ok: true });
}
