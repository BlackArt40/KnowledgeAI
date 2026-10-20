import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthSecret } from "./secrets";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAuthSecret", () => {
  it("returns the configured secret when set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "real-random-secret");
    expect(getAuthSecret("dev-fallback")).toBe("real-random-secret");
  });

  it("throws in production when unset or blank", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => getAuthSecret("dev-fallback")).toThrow(/AUTH_SECRET/);
  });

  it("throws in production for the public .env.example placeholder", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "change-me-to-a-random-32-char-string");
    expect(() => getAuthSecret("dev-fallback")).toThrow(/公开占位符/);
  });

  it("falls back to the dev key outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_SECRET", "");
    expect(getAuthSecret("dev-fallback")).toBe("dev-fallback");
  });
});
