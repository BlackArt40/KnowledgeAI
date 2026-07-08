import { NextResponse } from "next/server";
import { cancelSubscription, resumeSubscription } from "@/lib/billing/store";
export const dynamic = "force-dynamic";

// POST /api/billing/cancel  { action: "cancel" | "resume" }
export async function POST(req: Request) {
  let body: { action?: "cancel" | "resume" };
  try { body = await req.json(); } catch { body = { action: "cancel" }; }
  const sub = body.action === "resume" ? resumeSubscription() : cancelSubscription();
  return NextResponse.json({ subscription: sub });
}
