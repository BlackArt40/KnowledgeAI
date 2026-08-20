import { NextResponse } from "next/server";
import { createOrder } from "@/lib/billing/store";
import { getRequestUser } from "@/lib/auth/guard";
import { createCheckoutSession, isPaymentEnabled } from "@/lib/billing/provider";
import { PLANS } from "@/lib/billing/plans";
import type { PlanId, PayMethod } from "@/lib/billing/types";
export const dynamic = "force-dynamic";

// POST /api/billing/checkout  { plan, method } → create order + checkout session
export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  let body: { plan?: PlanId; method?: PayMethod };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  // P1-11: strict whitelist - an arbitrary plan string must never reach
  // createOrder (it was previously written straight into subscription.plan).
  if (!body.plan || !body.method) {
    return NextResponse.json({ error: "plan 与 method 必填" }, { status: 400 });
  }
  const validPlans: PlanId[] = ["free", "pro", "enterprise"];
  if (!validPlans.includes(body.plan) || body.plan === "free") {
    return NextResponse.json({ error: "plan 非法（仅支持 pro / enterprise）" }, { status: 400 });
  }
  const validMethods: PayMethod[] = ["wechat", "alipay", "card"];
  if (!validMethods.includes(body.method)) {
    return NextResponse.json({ error: "method 非法" }, { status: 400 });
  }
  // PLANS is imported to keep the whitelist tied to the actual catalog;
  // validate against the same source of truth used by getPlan.
  if (!PLANS.some((p) => p.id === body.plan)) {
    return NextResponse.json({ error: "plan 非法" }, { status: 400 });
  }
  const order = createOrder(body.plan, body.method, user.id);

  // If Stripe is configured, create a real checkout session
  if (isPaymentEnabled()) {
    const session = await createCheckoutSession(body.plan, body.method, order.id);
    return NextResponse.json({ order, checkout: session }, { status: 201 });
  }

  // Mock mode: client uses the 2-step flow (create → pay)
  return NextResponse.json({ order }, { status: 201 });
}
