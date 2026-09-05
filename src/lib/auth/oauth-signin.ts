// P3-2: client-side OAuth sign-in kickoff (Auth.js v5).
//
// Auth.js v5 does NOT support GET /api/auth/signin/{provider} (it throws
// "Unsupported action" -> Configuration redirect). The official flow is a
// CSRF-protected POST: fetch the csrf token, then POST to the signin action
// with `redirect: "manual"` and navigate to the returned Location (the
// provider authorize URL). The state / PKCE / CSRF cookies set by Auth.js on
// that response are stored by the browser, so the follow-up navigation
// carries them.

export interface OAuthSignInOptions {
  /** provider id — narrowed to the configured providers at compile time
   *  (canonical list: OAUTH_PROVIDERS in oauth-link.ts); the runtime
   *  allowlist below stays as defense-in-depth. */
  provider: "google" | "github";
  /** in-app redirect target after the bridge (default /dashboard) */
  callbackUrl?: string;
}

export async function oauthSignIn({ provider, callbackUrl = "/dashboard" }: OAuthSignInOptions): Promise<void> {
  // Provider allowlist: the value is interpolated into the signin URL path,
  // so anything beyond the configured providers is rejected up front.
  if (provider !== "google" && provider !== "github") {
    window.location.href = `/login?error=oauth_failed`;
    return;
  }
  // Open-redirect guard: the callback must be an in-app absolute path
  // (Auth.js treats it as the post-bridge redirect target).
  const safeCallback =
    callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/dashboard";
  let csrf: { csrfToken?: string };
  try {
    csrf = await fetch("/api/auth/csrf").then((r) => r.json());
  } catch {
    window.location.href = `/login?error=oauth_failed`;
    return;
  }
  // Literal signin paths per provider (the provider value never reaches the
  // request URL - unknown providers are rejected by the allowlist above).
  const providerPath = provider === "google" ? "/api/auth/signin/google" : "/api/auth/signin/github";
  const target = `${providerPath}?callbackUrl=${encodeURIComponent(safeCallback)}`;
  const res = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken ?? "" }),
    redirect: "manual",
  });
  if (res.status === 302) {
    const loc = res.headers.get("location");
    if (loc) {
      // Normalize through URL so the redirect target is a parsed URL object,
      // not the raw response header string (Auth.js returns the provider's
      // authorize URL here - cross-origin by design, so no origin pinning).
      window.location.assign(new URL(loc, window.location.origin).href);
      return;
    }
  }
  // Provider unconfigured / CSRF failure -> land on login with a message.
  window.location.href = `/login?error=${res.status === 401 ? "oauth_failed" : "Configuration"}`;
}
