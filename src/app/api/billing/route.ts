import { NextResponse } from "next/server";
import { getSubscription, listInvoices, getUsage, getWorkspaceUsage } from "@/lib/billing/store";
import { PLANS } from "@/lib/billing/plans";
import { getRequestUser } from "@/lib/auth/guard";
import { getWorkspace } from "@/lib/workspace/store";
export const dynamic = "force-dynamic";

// GET /api/billing - subscription (org) + CURRENT user's usage + invoices + plans
// P4-3: also returns the current workspace's plan + usage (tenant billing).
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const ws = getWorkspace(user.workspaceId);
  return NextResponse.json({
    subscription: getSubscription(user.id),
    usage: getUsage(user.id),
    invoices: listInvoices(user.id),
    plans: PLANS,
    workspace: ws
      ? {
          id: ws.id,
          name: ws.name,
          plan: ws.plan,
          usage: getWorkspaceUsage(ws.id),
        }
      : null,
  });
}
