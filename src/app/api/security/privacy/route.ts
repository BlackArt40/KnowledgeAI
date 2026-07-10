import { NextResponse } from "next/server";
import { updatePrivacy } from "@/lib/security/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
export async function PATCH(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  return NextResponse.json({ privacy: updatePrivacy(u.id, body) });
}
