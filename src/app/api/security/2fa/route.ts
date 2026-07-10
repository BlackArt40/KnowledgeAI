import { NextResponse } from "next/server";
import { enable2FA, disable2FA } from "@/lib/security/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const u = await getRequestUser(req);
  if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { enable?: boolean; method?: "app" | "sms" };
  try { body = await req.json(); } catch { body = {}; }
  const tf = body.enable === false ? disable2FA(u.id) : enable2FA(u.id, body.method ?? "app");
  return NextResponse.json({ twoFactor: tf });
}
