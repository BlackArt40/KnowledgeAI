// P0 (batch 1): Auth.js v5 engine config — env-gated providers, issuer
// overrides, GitHub profile fallbacks, and the two callbacks the bridge relies
// on (jwt carries the provider identity; redirect keeps the flow in-app).
//
// The module evaluates env at import time, so each case re-imports it after
// resetting the module registry and re-mocking next-auth.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface ProviderConfig {
  id?: string;
  clientId?: string;
  clientSecret?: string;
  issuer?: string;
  authorization?: { url?: string };
  token?: string;
  userinfo?: string;
  profile?: (profile: Record<string, unknown>) => Record<string, unknown>;
}

interface AuthJsConfig {
  secret: string;
  trustHost: boolean;
  session: { strategy: string; maxAge: number };
  pages: { signIn: string; error: string };
  providers: ProviderConfig[];
  callbacks: {
    jwt: (args: {
      token: Record<string, unknown>;
      account?: { provider?: string; providerAccountId?: string } | null;
    }) => Record<string, unknown>;
    redirect: (args: { url: string; baseUrl: string }) => string;
  };
}

const h = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock("next-auth", () => ({
  default: (cfg: unknown) => {
    h.calls.push(cfg);
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/google", () => ({
  default: (opts: Record<string, unknown>) => ({ id: "google", ...opts }),
}));
vi.mock("next-auth/providers/github", () => ({
  default: (opts: Record<string, unknown>) => ({ id: "github", ...opts }),
}));

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_ISSUER",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_ISSUER",
  "AUTH_SECRET",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.AUTH_SECRET = "test-secret-for-authjs";
  h.calls.length = 0;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

async function load(): Promise<AuthJsConfig> {
  vi.resetModules();
  await import("./authjs");
  const cfg = h.calls.at(-1);
  if (!cfg) throw new Error("NextAuth was not called");
  return cfg as AuthJsConfig;
}

describe("authjs provider wiring", () => {
  it("registers no providers when no credentials are configured", async () => {
    const cfg = await load();
    expect(cfg.providers).toEqual([]);
    expect(cfg.secret).toBe("test-secret-for-authjs");
    expect(cfg.session).toEqual({ strategy: "jwt", maxAge: 30 * 86400 });
    expect(cfg.pages).toEqual({ signIn: "/login", error: "/login" });
    expect(cfg.trustHost).toBe(true);
  });

  it("omits a provider when only the id is configured", async () => {
    process.env.GOOGLE_CLIENT_ID = "google-id";
    const cfg = await load();
    expect(cfg.providers).toEqual([]);
  });

  it("adds Google with its credentials and issuer override", async () => {
    process.env.GOOGLE_CLIENT_ID = "google-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    process.env.GOOGLE_ISSUER = "http://localhost:9400";
    const cfg = await load();

    expect(cfg.providers).toHaveLength(1);
    expect(cfg.providers[0]).toMatchObject({
      id: "google",
      clientId: "google-id",
      clientSecret: "google-secret",
      issuer: "http://localhost:9400",
    });
  });

  it("adds GitHub with explicit endpoints when GITHUB_ISSUER is set", async () => {
    process.env.GITHUB_CLIENT_ID = "gh-id";
    process.env.GITHUB_CLIENT_SECRET = "gh-secret";
    process.env.GITHUB_ISSUER = "http://localhost:9500";
    const cfg = await load();

    expect(cfg.providers[0]).toMatchObject({
      id: "github",
      issuer: "http://localhost:9500",
      authorization: { url: "http://localhost:9500/authorize" },
      token: "http://localhost:9500/token",
      userinfo: "http://localhost:9500/userinfo",
    });
  });

  it("keeps GitHub endpoints discovery-derived without an issuer", async () => {
    process.env.GITHUB_CLIENT_ID = "gh-id";
    process.env.GITHUB_CLIENT_SECRET = "gh-secret";
    const cfg = await load();

    expect(cfg.providers[0].issuer).toBeUndefined();
    expect(cfg.providers[0].authorization).toBeUndefined();
  });

  it("registers both providers when both are configured", async () => {
    process.env.GOOGLE_CLIENT_ID = "g";
    process.env.GOOGLE_CLIENT_SECRET = "gs";
    process.env.GITHUB_CLIENT_ID = "h";
    process.env.GITHUB_CLIENT_SECRET = "hs";
    const cfg = await load();

    expect(cfg.providers.map((p) => p.id)).toEqual(["google", "github"]);
  });
});

describe("authjs GitHub profile mapping", () => {
  async function githubProfile(): Promise<(p: Record<string, unknown>) => Record<string, unknown>> {
    process.env.GITHUB_CLIENT_ID = "gh-id";
    process.env.GITHUB_CLIENT_SECRET = "gh-secret";
    const cfg = await load();
    const profile = cfg.providers[0].profile;
    if (!profile) throw new Error("github profile mapper missing");
    return profile;
  }

  it("maps a full profile field by field", async () => {
    const profile = await githubProfile();
    expect(
      profile({ id: 42, name: "Ada", login: "ada", email: "ada@example.com", avatar_url: "https://x/a.png" })
    ).toEqual({ id: "42", name: "Ada", email: "ada@example.com", image: "https://x/a.png" });
  });

  it("falls back to the login when name is null", async () => {
    const profile = await githubProfile();
    expect(profile({ id: 7, name: null, login: "octocat" })).toMatchObject({ name: "octocat" });
  });

  it("falls back to a noreply address when email is hidden", async () => {
    const profile = await githubProfile();
    expect(profile({ id: 9, login: "octocat" })).toMatchObject({
      email: "octocat@users.noreply.github.com",
    });
    // No login either -> key on the numeric id.
    expect(profile({ id: 9 })).toMatchObject({ email: "9@users.noreply.github.com", name: "GitHub 用户" });
  });
});

describe("authjs callbacks", () => {
  it("carries the provider identity onto the Auth.js JWT", async () => {
    const cfg = await load();
    const token = cfg.callbacks.jwt({
      token: { sub: "u1" },
      account: { provider: "google", providerAccountId: "g-1" },
    });
    expect(token).toEqual({ sub: "u1", oauthProvider: "google", oauthProviderId: "g-1" });
  });

  it("leaves the token untouched on later jwt invocations (no account)", async () => {
    const cfg = await load();
    const token = { sub: "u1", oauthProvider: "github" };
    expect(cfg.callbacks.jwt({ token, account: null })).toBe(token);
    expect(cfg.callbacks.jwt({ token })).toBe(token);
  });

  it("keeps redirects inside the app base URL", async () => {
    const cfg = await load();
    const baseUrl = "http://localhost:3000";

    expect(cfg.callbacks.redirect({ url: "/dashboard", baseUrl })).toBe(`${baseUrl}/dashboard`);
    expect(cfg.callbacks.redirect({ url: `${baseUrl}/settings`, baseUrl })).toBe(`${baseUrl}/settings`);
    expect(cfg.callbacks.redirect({ url: "https://evil.example/steal", baseUrl })).toBe(baseUrl);
  });
});
