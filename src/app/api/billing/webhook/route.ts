import { NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/billing/provider";
import { payOrder } from "@/lib/billing/store";
export const dynamic = "force-dynamic";

// POST /api/billing/webhook — Stripe webhook handler
// Verifies signature → confirms payment → upgrades subscription
export async function POST(req: Request) {
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature") || "";

  if (!(await verifyWebhook(payload, signature))) {
    return NextResponse.json({ error: "无效的签名" }, { status: 400 });
  }

  const event = JSON.parse(payload);

  // Handle checkout.session.completed
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata?.order_id;
    if (orderId) {
      payOrder(orderId);
    }
  }

  return NextResponse.json({ received: true });
}
