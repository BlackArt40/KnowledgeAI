import { NextResponse } from "next/server";
import { getSubscription, listInvoices, getUsage } from "@/lib/billing/store";
import { PLANS } from "@/lib/billing/plans";
export const dynamic = "force-dynamic";

// GET /api/billing — subscription + usage + invoices + plans
export async function GET() {
  return NextResponse.json({
    subscription: getSubscription(),
    usage: getUsage(),
    invoices: listInvoices(),
    plans: PLANS,
  });
}
