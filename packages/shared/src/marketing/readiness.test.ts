import { describe, expect, it } from "vitest";
import { toReadinessPulse } from "./readiness";

describe("homepage readiness pulse", () => {
  it("does not report a healthy state when the readiness request fails", () => {
    expect(toReadinessPulse(null)).toEqual({
      state: "offline",
      checks: [],
    });
  });

  it("preserves real dependency states and latency for the homepage", () => {
    expect(
      toReadinessPulse({
        status: "ok",
        checks: [
          { name: "db", status: "ok", latencyMs: 42 },
          { name: "redis", status: "ok", latencyMs: 8 },
        ],
      }),
    ).toEqual({
      state: "online",
      checks: [
        { name: "db", status: "ok", latencyMs: 42 },
        { name: "redis", status: "ok", latencyMs: 8 },
      ],
    });
  });
});
