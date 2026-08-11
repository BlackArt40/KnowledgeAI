// P6-3 unit tests: billing/types (label maps).
import { describe, it, expect } from "vitest";
import { METHOD_LABEL, STATUS_LABEL } from "./types";

describe("billing label maps", () => {
  it("maps every payment method", () => {
    expect(METHOD_LABEL.wechat).toBe("微信支付");
    expect(METHOD_LABEL.alipay).toBe("支付宝");
    expect(METHOD_LABEL.card).toBe("信用卡");
  });

  it("maps every subscription status", () => {
    expect(STATUS_LABEL.active).toBe("生效中");
    expect(STATUS_LABEL.trialing).toBe("试用中");
    expect(STATUS_LABEL.canceled).toBe("已取消");
    expect(STATUS_LABEL.past_due).toBe("待支付");
  });
});
