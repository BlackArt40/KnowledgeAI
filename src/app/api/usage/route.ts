import { NextResponse } from "next/server";
import { getUsage, getSubscription } from "@/lib/billing/store";
import { getPlan } from "@/lib/billing/plans";
import { totalStorageBytes } from "@/lib/kb/store";
import { listTasks } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";

// GET /api/usage - the CURRENT user's usage meters. qaUsed / trend are tracked
// per user (real, incremented on each question); storage & agent counts are
// org-wide real figures (KBs and tasks are shared across the team).
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const usage = getUsage(user.id);
  const sub = getSubscription(user.id);
  const plan = getPlan(sub.plan);

  return NextResponse.json({
    usage: {
      ...usage,
      qaLimit: plan.qaLimit,
      storageUsed: totalStorageBytes(user.id),
      storageLimit: plan.id === "enterprise" ? null : 1024 * 1024 * 1024,
      agentTasks: listTasks().length,
      agentLimit: plan.agent ? (plan.id === "enterprise" ? null : 100) : 0,
    },
    plan: sub.plan,
  });
}
