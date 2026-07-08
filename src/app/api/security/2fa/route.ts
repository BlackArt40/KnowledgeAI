import { NextResponse } from "next/server";
import { enable2FA, disable2FA } from "@/lib/security/store";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  let body: { enable?: boolean; method?: "app" | "sms" };
  try { body = await req.json(); } catch { body = {}; }
  const tf = body.enable === false ? disable2FA() : enable2FA(body.method ?? "app");
  return NextResponse.json({ twoFactor: tf });
}
