import { NextResponse } from "next/server";
import { updatePrivacy } from "@/lib/security/store";
export const dynamic = "force-dynamic";
export async function PATCH(req: Request) {
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  return NextResponse.json({ privacy: updatePrivacy(body) });
}
