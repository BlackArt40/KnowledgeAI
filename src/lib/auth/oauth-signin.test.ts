// P0 (batch 1): client-side OAuth kickoff — CSRF POST flow, provider
// allowlist, open-redirect guard and every failure redirect.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { oauthSignIn } from "./oauth-signin";

type Loc = { assign: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn>; origin: string };

let loc: Loc;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  loc = { assign: vi.fn(), replace: vi.fn(), origin: "http://localhost:4173" };
  vi.stubGlobal("window", { location: loc });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("oauthSignIn", () => {
  it("POSTs the CSRF token then follows the provider redirect", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "csrf-123" }))
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://accounts.google.com/o/oauth2/v2/auth?x=1" } })
      );
    vi.stubGlobal("fetch", fetchMock);

    await oauthSignIn({ provider: "google" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/auth/signin/google?callbackUrl=%2Fdashboard");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(String(init.body)).toContain("csrfToken=csrf-123");
    expect(loc.assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1");
    expect(loc.replace).not.toHaveBeenCalled();
  });

  it("uses the github signin path for the github provider", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "c" }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://github.com/login/oauth/authorize" } }));
    vi.stubGlobal("fetch", fetchMock);

    await oauthSignIn({ provider: "github" });

    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/signin/github?callbackUrl=%2Fdashboard");
  });

  it("keeps an in-app callbackUrl and encodes it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "c" }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://idp.example/authorize" } }));
    vi.stubGlobal("fetch", fetchMock);

    await oauthSignIn({ provider: "google", callbackUrl: "/settings?tab=security" });

    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/auth/signin/google?callbackUrl=%2Fsettings%3Ftab%3Dsecurity"
    );
  });

  it.each([
    ["//evil.example/steal", "%2Fdashboard"],
    ["https://evil.example/steal", "%2Fdashboard"],
  ])("replaces an off-app callbackUrl %s with /dashboard", async (callbackUrl, encoded) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "c" }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://idp.example/authorize" } }));
    vi.stubGlobal("fetch", fetchMock);

    await oauthSignIn({ provider: "google", callbackUrl });

    expect(fetchMock.mock.calls[1][0].toString()).toContain(`callbackUrl=${encoded}`);
  });

  it("rejects a provider outside the allowlist before any fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await oauthSignIn({ provider: "gitlab" as unknown as "github" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(loc.replace).toHaveBeenCalledWith("/login?error=oauth_failed");
  });

  it("redirects to login when the CSRF request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await oauthSignIn({ provider: "google" });

    expect(loc.replace).toHaveBeenCalledWith("/login?error=oauth_failed");
    expect(loc.assign).not.toHaveBeenCalled();
  });

  it("maps a 401 to oauth_failed and anything else to Configuration", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "c" }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "c" }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await oauthSignIn({ provider: "google" });
    expect(loc.replace).toHaveBeenLastCalledWith("/login?error=oauth_failed");

    await oauthSignIn({ provider: "google" });
    expect(loc.replace).toHaveBeenLastCalledWith("/login?error=Configuration");
  });

  it("treats a 302 without Location as a configuration failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "c" }))
      .mockResolvedValueOnce(new Response(null, { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);

    await oauthSignIn({ provider: "google" });

    expect(loc.replace).toHaveBeenCalledWith("/login?error=Configuration");
    expect(loc.assign).not.toHaveBeenCalled();
  });

  it("normalizes a relative provider Location against the app origin", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: "c" }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/mock-authorize?state=x" } }));
    vi.stubGlobal("fetch", fetchMock);

    await oauthSignIn({ provider: "github" });

    expect(loc.assign).toHaveBeenCalledWith("http://localhost:4173/mock-authorize?state=x");
  });
});
