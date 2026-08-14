// P6-3 unit tests: billing/provider (demo mock path, zero network;
// real-Stripe paths run against a mocked `stripe` module).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isPaymentEnabled, paymentLabel, createCheckoutSession, verifyWebhook } from "./provider";

// Mock the official stripe SDK: the ctor returns an instance whose
// checkout.sessions.create / webhooks.constructEvent are controllable fns.
// NOTE: the implementation MUST be a `function` (not an arrow) - the real
// code does `new Stripe(key)`, and arrow functions are not constructors.
const { mockStripeCtor, mockCreateSession, mockConstructEvent } = vi.hoisted(() => {
  const mockCreateSession = vi.fn();
  const mockConstructEvent = vi.fn();
  const mockStripeCtor = vi.fn(function () {
    return {
      checkout: { sessions: { create: mockCreateSession } },
      webhooks: { constructEvent: mockConstructEvent },
    };
  });
  return { mockStripeCtor, mockCreateSession, mockConstructEvent };
});

vi.mock("stripe", () => ({ default: mockStripeCtor }));

const env = process.env;

beforeEach(() => {
  mockCreateSession.mockReset();
  mockConstructEvent.mockReset();
  mockStripeCtor.mockClear();
});

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
    expect(mockStripeCtor).not.toHaveBeenCalled();
  });

  it("verifyWebhook rejects without a signature / payload", async () => {
    expect(await verifyWebhook("{}", "")).toBe(false);
    expect(await verifyWebhook("", "t=1,v1=sig")).toBe(false);
    expect(mockStripeCtor).not.toHaveBeenCalled();
  });
});

describe("billing provider with the stripe SDK", () => {
  it("createCheckoutSession creates a real session via the SDK", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_pro_1");
    mockCreateSession.mockResolvedValueOnce({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });
    const out = await createCheckoutSession("pro", "alipay", "ord_1");
    expect(out.mode).toBe("redirect");
    expect(out.sessionId).toBe("cs_test_123");
    expect(out.url).toContain("checkout.stripe.com");
    expect(mockStripeCtor).toHaveBeenCalledWith("sk_test_123");
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        metadata: { order_id: "ord_1", plan: "pro", method: "alipay" },
        line_items: [{ price: "price_pro_1", quantity: 1 }],
      })
    );
  });

  it("createCheckoutSession uses one-time price_data when no price id is set", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    mockCreateSession.mockResolvedValueOnce({ id: "cs_test_2", url: "https://checkout.stripe.com/c/pay/cs_test_2" });
    const out = await createCheckoutSession("enterprise", "card", "ord_2");
    expect(out.mode).toBe("redirect");
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        line_items: [expect.objectContaining({ price_data: expect.objectContaining({ currency: "cny" }) })],
      })
    );
  });

  it("createCheckoutSession falls back to mock when the SDK call throws", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    mockCreateSession.mockRejectedValueOnce(new Error("card declined"));
    const out = await createCheckoutSession("pro", "alipay", "ord_1");
    expect(out.mode).toBe("mock");
    expect(out.sessionId).toBe("ord_1");
  });

  it("verifyWebhook accepts a valid signature (SDK constructEvent passes)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    mockConstructEvent.mockReturnValueOnce({ id: "evt_1" });
    expect(await verifyWebhook("{}", "t=1700000000,v1=sig")).toBe(true);
    expect(mockConstructEvent).toHaveBeenCalledWith("{}", "t=1700000000,v1=sig", "whsec_test");
  });

  it("verifyWebhook rejects a forged/invalid signature (SDK throws)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error("No signatures found matching the expected signature");
    });
    expect(await verifyWebhook("{}", "t=1700000000,v1=forged")).toBe(false);
  });
});
