import { describe, expect, it } from "vitest";
import { PLAN_LABEL_KEYS, planLabelKey } from "./plan";

describe("planLabelKey", () => {
  it("maps every backend plan enum to an i18n key", () => {
    expect(planLabelKey("free")).toBe("page.usage.planFree");
    expect(planLabelKey("pro")).toBe("page.usage.planPro");
    expect(planLabelKey("enterprise")).toBe("page.usage.planEnt");
  });

  it("returns null for unknown/empty plans so callers can fall back", () => {
    expect(planLabelKey("")).toBeNull();
    expect(planLabelKey(undefined)).toBeNull();
    expect(planLabelKey(null)).toBeNull();
    expect(planLabelKey("trial")).toBeNull();
  });

  it("keeps the mapping table and the resolver in sync", () => {
    for (const plan of Object.keys(PLAN_LABEL_KEYS)) {
      expect(planLabelKey(plan)).toBe(PLAN_LABEL_KEYS[plan]);
    }
  });
});
