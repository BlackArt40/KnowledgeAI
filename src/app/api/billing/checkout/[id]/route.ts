import { NextResponse } from "next/server";
import { payOrder, getSubscription, listInvoices } from "@/lib/billing/store";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

// POST /api/billing/checkout/[id] → simulate payment
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const { order, success } = payOrder(id);
  if (!success) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  return NextResponse.json({ order, subscription: getSubscription(), invoices: listInvoices(), success: true });
}
