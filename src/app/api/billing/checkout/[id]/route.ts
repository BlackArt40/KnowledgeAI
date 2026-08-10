import { NextResponse } from "next/server";
import { payOrder, getSubscription, listInvoices } from "@/lib/billing/store";
import { getRequestUser } from "@/lib/auth/guard";
import { setWorkspacePlan } from "@/lib/workspace/store";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// POST /api/billing/checkout/[id] → simulate payment
// P4-3: a successful payment also upgrades the current workspace's plan.
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const user = await getRequestUser(_req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { order, success } = payOrder(id, user.id);
  if (!success) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  if (order.plan === "pro" || order.plan === "enterprise") {
    setWorkspacePlan(user.workspaceId, order.plan);
  }
  return NextResponse.json({ order, subscription: getSubscription(user.id), invoices: listInvoices(user.id), success: true });
}
