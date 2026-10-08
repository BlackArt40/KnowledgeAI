// F17: the four CORS reflection states for the header-auth public API
// (corsHeaders, extracted from src/proxy.ts). The infra smoke suite covers
// these rules end-to-end; these unit tests give regular CI a fast regression net.
import { describe, it, expect, afterEach, vi } from "vitest";
import { corsHeaders } from "./cors";

const ORIGIN = "https://widget.example.com";

describe("corsHeaders (F17 reflection rules)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reflects an allowlisted Origin and sends the full CORS set + Vary", () => {
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://a.example.com, https://widget.example.com");
    vi.stubEnv("NODE_ENV", "production");

    const h = corsHeaders(ORIGIN);

    expect(h["Vary"]).toBe("Origin");
    expect(h["Access-Control-Allow-Origin"]).toBe(ORIGIN);
    expect(h["Access-Control-Allow-Methods"]).toContain("POST");
    expect(h["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(h["Access-Control-Max-Age"]).toBe("86400");
  });

  it("omits Access-Control-Allow-Origin when the Origin is not on a non-empty allowlist", () => {
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://other.example.com");
    vi.stubEnv("NODE_ENV", "production");

    const h = corsHeaders(ORIGIN);

    expect(h["Vary"]).toBe("Origin");
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(h["Access-Control-Allow-Methods"]).toBeUndefined();
    expect(h["Access-Control-Max-Age"]).toBeUndefined();
  });

  it("reflects any Origin with no allowlist in a non-production env", () => {
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "");
    vi.stubEnv("NODE_ENV", "development");

    const h = corsHeaders(ORIGIN);

    expect(h["Vary"]).toBe("Origin");
    expect(h["Access-Control-Allow-Origin"]).toBe(ORIGIN);
  });

  it("omits Access-Control-Allow-Origin with no allowlist in production", () => {
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "");
    vi.stubEnv("NODE_ENV", "production");

    const h = corsHeaders(ORIGIN);

    expect(h["Vary"]).toBe("Origin");
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("trims whitespace around allowlist entries", () => {
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "  https://widget.example.com  ");
    vi.stubEnv("NODE_ENV", "production");

    expect(corsHeaders(ORIGIN)["Access-Control-Allow-Origin"]).toBe(ORIGIN);
  });
});
