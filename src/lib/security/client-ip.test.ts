import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIpFromHeaders } from "./client-ip";

function h(headers: Record<string, string>): Headers {
  return new Headers(headers);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIpFromHeaders", () => {
  it("uses the proxy-appended rightmost XFF entry, not the client-controlled left entry", () => {
    // Attacker sends "1.2.3.4"; nginx appends the real address.
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("supports multiple trusted proxy hops", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.9, 10.0.0.5" }))).toBe("203.0.113.9");
  });

  it("falls back to X-Real-IP and then unknown", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIpFromHeaders(h({}))).toBe("unknown");
  });
});
