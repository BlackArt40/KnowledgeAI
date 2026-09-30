import { NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/billing/provider";
import { payOrder, getOrder } from "@/lib/billing/store";
import { loadOrderFromDb } from "@/lib/db/hydrate";
import { log } from "@/lib/obs/log";
export const dynamic = "force-dynamic";

// F12: processed event ids (Stripe retries on any non-2xx, and the same event
// can arrive more than once). Bounded ring; the in-memory order state means a
// restart re-processing is already idempotent via payOrder, so this only needs
// to stop the repeat work inside one process lifetime.
const SEEN_EVENT_CAP = 500;
const g = globalThis as unknown as { __KAI_STRIPE_SEEN__?: { ids: Set<string>; order: string[] } };

function seenEvents() {
  if (!g.__KAI_STRIPE_SEEN__) g.__KAI_STRIPE_SEEN__ = { ids: new Set(), order: [] };
  return g.__KAI_STRIPE_SEEN__;
}

function alreadyProcessed(id: string): boolean {
  const s = seenEvents();
  if (s.ids.has(id)) return true;
  s.ids.add(id);
  s.order.push(id);
  if (s.order.length > SEEN_EVENT_CAP) {
    const oldest = s.order.shift();
    if (oldest) s.ids.delete(oldest);
  }
  return false;
}

// POST /api/billing/webhook — Stripe webhook handler
// Verifies signature → confirms payment → upgrades subscription
export async function POST(req: Request) {
  const payload = await req.text();
  const signature = req.headers.get("stripe-signature") || "";

  if (!(await verifyWebhook(payload, signature))) {
    return NextResponse.json({ error: "无效的签名" }, { status: 400 });
  }

  // F12: a correctly-signed but non-JSON body used to throw out of the handler
  // and return 500, which makes Stripe retry the same payload forever.
  let event: { id?: string; type?: string; data?: { object?: { metadata?: { order_id?: string } } } };
  try {
    event = JSON.parse(payload);
  } catch {
    log.warn({ bytes: payload.length }, "[billing] webhook body 不是合法 JSON - 已忽略");
    // Acknowledge: retrying cannot help a malformed body.
    return NextResponse.json({ received: true, ignored: "invalid-json" });
  }

  // F12: de-duplicate by event id (Stripe is at-least-once).
  if (event.id && alreadyProcessed(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Handle checkout.session.completed
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    const orderId = session?.metadata?.order_id;
    if (orderId) {
      // The order may predate a restart -> hydrate it from the DB so a valid
      // payment is never silently dropped.
      if (!getOrder(orderId)) await loadOrderFromDb(orderId);
      const order = getOrder(orderId);
      if (order) payOrder(orderId, order.userId);
    }
  }

  return NextResponse.json({ received: true });
}
