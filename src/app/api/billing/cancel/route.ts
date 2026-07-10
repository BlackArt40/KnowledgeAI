import { NextResponse } from "next/server";
import { cancelSubscription, resumeSubscription } from "@/lib/billing/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";

// POST /api/billing/cancel  { action: "cancel" | "resume" }
export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { action?: "cancel" | "resume" };
  try { body = await req.json(); } catch { body = { action: "cancel" }; }
  const sub = body.action === "resume" ? resumeSubscription(user.id) : cancelSubscription(user.id);
  return NextResponse.json({ subscription: sub });
}
