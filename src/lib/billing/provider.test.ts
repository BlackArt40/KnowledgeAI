// P6-3 unit tests: billing/provider (demo mock path, zero network).
import { describe, it, expect, vi, afterEach } from "vitest";
import { isPaymentEnabled, paymentLabel, createCheckoutSession, verifyWebhook } from "./provider";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
  vi.unstubAllEnvs();
});

describe("billing provider gating", () => {
  it("isPaymentEnabled follows STRIPE_SECRET_KEY", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(isPaymentEnabled()).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    expect(isPaymentEnabled()).toBe(true);
  });

  it("paymentLabel reflects the mode", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(paymentLabel()).toBe("模拟支付（演示模式）");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    expect(paymentLabel()).toBe("Stripe");
  });

  it("createCheckoutSession returns mock mode without Stripe (no network)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const out = await createCheckoutSession("pro", "alipay", "ord_1");
    expect(out.mode).toBe("mock");
    expect(out.sessionId).toBe("ord_1");
  });

  it("verifyWebhook rejects without a signature / payload", async () => {
    expect(await verifyWebhook("{}", "")).toBe(false);
  });
});
