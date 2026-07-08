import { NextResponse } from "next/server";
import { getUsage } from "@/lib/billing/store";
import { getSubscription } from "@/lib/billing/store";
import { getPlan } from "@/lib/billing/plans";
export const dynamic = "force-dynamic";

// GET /api/usage — usage meters with limits derived from current plan
export async function GET() {
  const usage = getUsage();
  const sub = getSubscription();
  const plan = getPlan(sub.plan);
  return NextResponse.json({
    usage: {
      ...usage,
      qaLimit: plan.qaLimit,
      storageLimit: plan.id === "enterprise" ? null : 1024 * 1024 * 1024,
      agentLimit: plan.agent ? (plan.id === "enterprise" ? null : 100) : 0,
    },
    plan: sub.plan,
  });
}
