// P6-3 unit tests: billing/plans (pure plan table).
import { describe, it, expect } from "vitest";
import { PLANS, getPlan, COMPARISON } from "./plans";

describe("plans", () => {
  it("has all three plans in order with required fields", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["free", "pro", "enterprise"]);
    for (const p of PLANS) {
      expect(typeof p.name).toBe("string");
      expect(Array.isArray(p.features)).toBe(true);
      expect(p.features.length).toBeGreaterThan(0);
    }
  });

  it("getPlan resolves known plans and falls back to free", () => {
    expect(getPlan("pro").price).toBe(49);
    expect(getPlan("enterprise").seats).toBeNull();
    expect(getPlan("free").qaLimit).toBe(100);
    // @ts-expect-error unknown id falls back
    expect(getPlan("hacker").id).toBe("free");
  });

  it("comparison table covers all plans", () => {
    expect(COMPARISON.length).toBeGreaterThan(5);
    for (const row of COMPARISON) expect(row.values).toHaveLength(3);
  });
});
