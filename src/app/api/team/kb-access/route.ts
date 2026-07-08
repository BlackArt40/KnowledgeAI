import { NextResponse } from "next/server";
import { setKbAccess } from "@/lib/team/store";
import type { KbAccess } from "@/lib/team/types";

export const dynamic = "force-dynamic";

// PATCH /api/team/kb-access  { kbId, access }
export async function PATCH(req: Request) {
  let body: { kbId?: string; access?: KbAccess };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.kbId || !body.access) {
    return NextResponse.json({ error: "kbId 与 access 必填" }, { status: 400 });
  }
  setKbAccess(body.kbId, body.access);
  return NextResponse.json({ ok: true });
}
