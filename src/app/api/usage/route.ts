import { NextResponse } from "next/server";
import { getUsage, getSubscription, getWorkspaceUsage } from "@/lib/billing/store";
import { getPlan } from "@/lib/billing/plans";
import { listAllKbs, listDocuments } from "@/lib/kb/store";
import { listTasks } from "@/lib/agent/store";
import { getRequestUser } from "@/lib/auth/guard";
import { findUserByEmail } from "@/lib/auth/store";
import { getWorkspace } from "@/lib/workspace/store";
import { listMembers } from "@/lib/team/store";
import { can } from "@/lib/team/rbac";
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

  // Per-member breakdown is a management view (member.manage). Everyone else
  // keeps the workspace aggregate + their own meters only.
  const members = can(user.role, "member.manage")
    ? listMembers()
        .filter((m) => m.status === "active")
        .map((m) => {
          const account = findUserByEmail(m.email);
          const usage = account ? getUsage(account.id) : null;
          // Usage.agentTasks is workspace-level; per-user count comes from the
          // task list (same source the workspace aggregate uses).
          return {
            email: m.email,
            name: m.name,
            role: m.role,
            linked: !!account,
            qaUsed: usage?.qaUsed ?? 0,
            apiCalls: usage?.apiCalls ?? 0,
            agentTasks: account ? listTasks(account.id, user.workspaceId).length : 0,
          };
        })
    : undefined;

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
    members,
  });
}
