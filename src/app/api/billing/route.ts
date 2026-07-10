import { NextResponse } from "next/server";
import { getSubscription, listInvoices, getUsage } from "@/lib/billing/store";
import { PLANS } from "@/lib/billing/plans";
import { getRequestUser } from "@/lib/auth/guard";
export const dynamic = "force-dynamic";

// GET /api/billing - subscription (org) + CURRENT user's usage + invoices + plans
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({
    subscription: getSubscription(user.id),
    usage: getUsage(user.id),
    invoices: listInvoices(user.id),
    plans: PLANS,
  });
}
