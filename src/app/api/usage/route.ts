import { NextResponse } from "next/server";
import { getUsage, getSubscription, getWorkspaceUsage } from "@/lib/billing/store";
import { getPlan } from "@/lib/billing/plans";
import { listAllKbs, listDocuments } from "@/lib/kb/store";
import { listTasks } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";
import { getWorkspace } from "@/lib/workspace/store";
export const dynamic = "force-dynamic";

// GET /api/usage - usage meters for the CURRENT WORKSPACE (P4-3 tenant):
// per-workspace QA / agent counts + real storage & KB figures, with quotas
// derived from the workspace plan. Per-user meters remain available through
// the billing API.
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const ws = getWorkspace(user.workspaceId);
  const wsUsage = getWorkspaceUsage(user.workspaceId);
  const plan = getPlan(ws?.plan ?? "free");
  const kbs = listAllKbs(user.workspaceId);
  // storage: sum of all document sizes within this workspace
  const storageBytes = kbs.reduce(
    (s, kb) => s + listDocuments(kb.id).reduce((x, d) => x + Math.max(0, d.size), 0),
    0
  );
  const agentCount = listTasks(undefined, user.workspaceId).length;

  return NextResponse.json({
    usage: {
      workspaceId: user.workspaceId,
      qaUsed: wsUsage.qaUsed,
      qaLimit: plan.qaLimit,
      storageUsed: storageBytes,
      storageLimit: plan.id === "enterprise" ? null : 1024 * 1024 * 1024,
      agentTasks: agentCount,
      agentLimit: plan.agent ? (plan.id === "enterprise" ? null : 100) : 0,
      kbCount: kbs.length,
    },
    plan: ws?.plan ?? "free",
    // per-user meters kept for the billing page
    userUsage: {
      ...getUsage(user.id),
      qaLimit: plan.qaLimit,
    },
    userPlan: getSubscription(user.id).plan,
  });
}
