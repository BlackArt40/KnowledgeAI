// ---------------------------------------------------------------------------
// Auth.js v5 (next-auth) OAuth engine for P3-2 social login.
//
// NextAuth is used ONLY as the OAuth 2.0 protocol engine (authorization code
// + PKCE + state + CSRF + token exchange + profile fetch). The app's own
// session system (kai-token JWT consumed by getRequestUser / guard.ts) is
// untouched: after a successful provider dance, Auth.js redirects to
// /api/auth/oauth/bridge which mints the kai-token session (login mode) or
// links the identity to the current user (bind mode).
//
// Providers are env-gated: GOOGLE_CLIENT_ID/SECRET and GITHUB_CLIENT_ID/
// SECRET. When unset the provider is omitted from the config (Auth.js exposes
// the configured list via GET /api/auth/providers, which the login page uses
// to hide unconfigured buttons).
//
// Endpoint overrides (GOOGLE_AUTH_URL / GOOGLE_TOKEN_URL / GOOGLE_USERINFO_URL
// and GitHub equivalents) let acceptance tests point Auth.js at a local mock
// authorization server and support self-hosted proxy deployments.
// ---------------------------------------------------------------------------

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";

function envUrl(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

// Endpoint overrides for acceptance tests / self-hosted proxies. We override
// the ISSUER (not authorization/token/userinfo URLs) so Auth.js performs
// OIDC discovery against the custom base and takes all endpoints from the
// discovery document. Overriding `authorization.url` directly is avoided: a
// URL instance created in app code lives in a different realm than the one
// @auth/core bundles, and `new URL(foreignRealmURL)` throws
// "Receiver must be an instance of class URL" (verified on the prod build).
const googleIssuer = envUrl("GOOGLE_ISSUER");
const githubIssuer = envUrl("GITHUB_ISSUER");

const providers = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      ...(googleIssuer ? { issuer: googleIssuer } : {}),
    })
  );
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      // With a custom issuer, point every endpoint at it. URLs are passed
      // as STRINGS: @auth/core's normalizeEndpoint() converts them to URL
      // instances inside its own realm (a URL object created in app code
      // lives in a different realm and `new URL(foreignRealmURL)` throws -
      // verified on the prod build). Note that Auth.js overrides the
      // discovery-derived token/userinfo endpoints with the provider's own
      // config, so those must be explicit too.
      ...(githubIssuer
        ? {
            issuer: githubIssuer,
            authorization: { url: `${githubIssuer}/authorize` },
            token: `${githubIssuer}/token`,
            userinfo: `${githubIssuer}/userinfo`,
          }
        : {}),
      // GitHub hides the primary email unless the user grants it - fall back
      // to the noreply address so the bridge always has an email to key on.
      profile(profile) {
        return {
          id: String(profile.id),
          name: (profile as { name?: string | null }).name ?? (profile as { login?: string }).login ?? "GitHub 用户",
          email: profile.email ?? `${(profile as { login?: string }).login ?? profile.id}@users.noreply.github.com`,
          image: (profile as { avatar_url?: string | null }).avatar_url ?? null,
        };
      },
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Same secret as the kai-token HMAC - the Auth.js JWT (JWE) is encrypted
  // with it, and the bridge decrypts via getToken().
  secret: process.env.AUTH_SECRET || "dev-secret-change-in-production",
  // Required without a stable AUTH_URL in dev/containers.
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 86400 },
  pages: { signIn: "/login", error: "/login" },
  providers,
  callbacks: {
    // Carry the OAuth identity on the Auth.js JWT so the bridge route can
    // resolve the provider account via getToken() without touching the
    // provider API again (the session callback is intentionally unused -
    // Auth.js sessions are never exposed to the client; the app session is
    // the kai-token JWT minted by the bridge).
    jwt({ token, account }) {
      if (account?.provider) {
        token.oauthProvider = account.provider;
        token.oauthProviderId = account.providerAccountId;
      }
      return token;
    },
    // Bridge keeps the flow inside the app: after the provider dance the user
    // lands on /api/auth/oauth/bridge (mints kai-token / links account).
    redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },
});
