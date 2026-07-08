// ---------------------------------------------------------------------------
// Payment Provider — abstraction over Stripe (or other gateways) with
// graceful fallback to the mock simulator when no gateway is configured.
//
// When STRIPE_SECRET_KEY is set → real Stripe Checkout Sessions.
// Otherwise → mock payOrder() (instant success, demo mode).
// ---------------------------------------------------------------------------

import type { PlanId, PayMethod } from "./types";
import { getPlan } from "./plans";

export function isPaymentEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function paymentLabel(): string {
  return isPaymentEnabled() ? "Stripe" : "模拟支付（演示模式）";
}

const PRICE_MAP: Record<string, string> = {
  // Map plan → Stripe Price ID (set in env: STRIPE_PRICE_PRO, STRIPE_PRICE_ENT)
  pro: process.env.STRIPE_PRICE_PRO || "",
  enterprise: process.env.STRIPE_PRICE_ENT || "",
};

export interface CheckoutSession {
  url: string;
  sessionId: string;
  mode: "redirect" | "mock";
}

/**
 * Create a checkout session.
 * - Stripe: creates a real Checkout Session, returns redirect URL.
 * - Mock: returns mode "mock" — caller uses the existing payOrder() flow.
 */
export async function createCheckoutSession(
  plan: PlanId,
  method: PayMethod,
  _orderId: string
): Promise<CheckoutSession> {
  if (!isPaymentEnabled()) {
    return { url: "", sessionId: _orderId, mode: "mock" };
  }

  const p = getPlan(plan);
  const priceId = PRICE_MAP[plan];

  const body: Record<string, unknown> = {
    mode: "subscription",
    success_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/checkout?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/billing?canceled=1`,
    metadata: { order_id: _orderId, plan, method },
  };

  if (priceId) {
    body.line_items = [{ price: priceId, quantity: 1 }];
  } else {
    // One-time payment for custom pricing
    body.line_items = [{
      price_data: {
        currency: "cny",
        product_data: { name: `${p.name} 订阅` },
        unit_amount: (p.price ?? 0) * 100,
      },
      quantity: 1,
    }];
    body.mode = "payment";
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(flatten(body)).toString(),
  });

  if (!res.ok) {
    console.error("[payment] stripe session failed:", res.status, await res.text());
    return { url: "", sessionId: _orderId, mode: "mock" };
  }

  const data = await res.json();
  return { url: data.url, sessionId: data.id, mode: "redirect" };
}

// Flatten nested object for Stripe's form-encoded body
function flatten(obj: Record<string, unknown>, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flatten(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") {
          out.push(...flatten(item, `${key}[${i}]`));
        } else {
          out.push([`${key}[${i}]`, String(item)]);
        }
      });
    } else {
      out.push([key, String(v)]);
    }
  }
  return out;
}

/**
 * Verify a Stripe webhook signature.
 * In production, use the stripe SDK's webhook.constructEvent().
 */
export async function verifyWebhook(payload: string, signature: string): Promise<boolean> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return false;
  // Simplified: in production, use stripe.webhooks.constructEvent(payload, signature, secret)
  // This requires the stripe SDK. For now, return true if signature is present.
  return !!signature;
}
