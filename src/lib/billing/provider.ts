// ---------------------------------------------------------------------------
// Payment Provider — abstraction over Stripe (or other gateways) with
// graceful fallback to the mock simulator when no gateway is configured.
//
// When STRIPE_SECRET_KEY is set → real Stripe Checkout Sessions via the
// official `stripe` SDK (loaded lazily - demo mode never touches it, same
// pattern as @aws-sdk in storage/s3.ts). Otherwise → mock payOrder()
// (instant success, demo mode).
// ---------------------------------------------------------------------------

import type Stripe from "stripe";
import type { PlanId, PayMethod } from "./types";
import { getPlan } from "./plans";
import { log, redactText } from "@/lib/obs/log";

type StripeCtor = new (apiKey: string) => Stripe;

/**
 * Lazily create the Stripe client. Returns null when the SDK is unavailable
 * (never happens in a normal install) - caller falls back to mock mode.
 */
async function getStripe(): Promise<Stripe | null> {
  try {
    const mod = await import("stripe");
    const ctor = (mod as { default?: StripeCtor }).default ?? (mod as unknown as StripeCtor);
    return new ctor(process.env.STRIPE_SECRET_KEY || "");
  } catch (e) {
    log.warn({ err: e }, "[payment] stripe SDK unavailable - mock fallback");
    return null;
  }
}

export function isPaymentEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function paymentLabel(): string {
  return isPaymentEnabled() ? "Stripe" : "模拟支付（演示模式）";
}

const PRICE_ENV: Record<string, string> = {
  // Map plan → env var holding the Stripe Price ID (STRIPE_PRICE_PRO / STRIPE_PRICE_ENT)
  pro: "STRIPE_PRICE_PRO",
  enterprise: "STRIPE_PRICE_ENT",
};

/** Lazy env lookup so runtime config changes (and tests) take effect. */
function priceIdFor(plan: string): string {
  return process.env[PRICE_ENV[plan] || ""] || "";
}

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

  const stripe = await getStripe();
  if (!stripe) {
    return { url: "", sessionId: _orderId, mode: "mock" };
  }

  const p = getPlan(plan);
  const priceId = priceIdFor(plan);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  try {
    const params: Stripe.Checkout.SessionCreateParams = {
      // priceId set → recurring subscription; otherwise one-time custom pricing
      mode: priceId ? "subscription" : "payment",
      success_url: `${baseUrl}/checkout?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/billing?canceled=1`,
      metadata: { order_id: _orderId, plan, method },
      line_items: priceId
        ? [{ price: priceId, quantity: 1 }]
        : [{
            price_data: {
              currency: "cny",
              product_data: { name: `${p.name} 订阅` },
              unit_amount: (p.price ?? 0) * 100,
            },
            quantity: 1,
          }],
    };
    const session = await stripe.checkout.sessions.create(params);
    return { url: session.url || "", sessionId: session.id, mode: "redirect" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: e, body: redactText(msg) }, "[payment] stripe session failed");
    return { url: "", sessionId: _orderId, mode: "mock" };
  }
}

/**
 * Verify a Stripe webhook signature via the official SDK.
 * `stripe.webhooks.constructEvent()` validates the HMAC signature AND the
 * timestamp tolerance (default ±300s) and throws on any mismatch - never
 * trust a bare signature header.
 */
export async function verifyWebhook(payload: string, signature: string): Promise<boolean> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature || !payload) return false;
  const stripe = await getStripe();
  if (!stripe) return false;
  try {
    stripe.webhooks.constructEvent(payload, signature, secret);
    return true;
  } catch (e) {
    log.warn({ err: e }, "[payment] stripe webhook signature verification failed");
    return false;
  }
}
