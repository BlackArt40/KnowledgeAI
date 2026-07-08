import { NextResponse } from "next/server";
import { createOrder } from "@/lib/billing/store";
import { createCheckoutSession, isPaymentEnabled } from "@/lib/billing/provider";
import type { PlanId, PayMethod } from "@/lib/billing/types";
export const dynamic = "force-dynamic";

// POST /api/billing/checkout  { plan, method } → create order + checkout session
export async function POST(req: Request) {
  let body: { plan?: PlanId; method?: PayMethod };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.plan || !body.method) {
    return NextResponse.json({ error: "plan 与 method 必填" }, { status: 400 });
  }
  const order = createOrder(body.plan, body.method);

  // If Stripe is configured, create a real checkout session
  if (isPaymentEnabled()) {
    const session = await createCheckoutSession(body.plan, body.method, order.id);
    return NextResponse.json({ order, checkout: session }, { status: 201 });
  }

  // Mock mode: client uses the 2-step flow (create → pay)
  return NextResponse.json({ order }, { status: 201 });
}
