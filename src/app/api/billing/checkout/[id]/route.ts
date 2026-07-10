import { NextResponse } from "next/server";
import { payOrder, getSubscription, listInvoices } from "@/lib/billing/store";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// POST /api/billing/checkout/[id] → simulate payment
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const user = await getRequestUser(_req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { order, success } = payOrder(id, user.id);
  if (!success) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  return NextResponse.json({ order, subscription: getSubscription(user.id), invoices: listInvoices(user.id), success: true });
}
