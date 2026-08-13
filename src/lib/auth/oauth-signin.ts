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
  /** provider id ("google" | "github") */
  provider: string;
  /** in-app redirect target after the bridge (default /dashboard) */
  callbackUrl?: string;
}

export async function oauthSignIn({ provider, callbackUrl = "/dashboard" }: OAuthSignInOptions): Promise<void> {
  let csrf: { csrfToken?: string };
  try {
    csrf = await fetch("/api/auth/csrf").then((r) => r.json());
  } catch {
    window.location.href = `/login?error=oauth_failed`;
    return;
  }
  const target = `/api/auth/signin/${provider}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  const res = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken ?? "" }),
    redirect: "manual",
  });
  if (res.status === 302) {
    const loc = res.headers.get("location");
    if (loc) {
      window.location.assign(loc);
      return;
    }
  }
  // Provider unconfigured / CSRF failure -> land on login with a message.
  window.location.href = `/login?error=${res.status === 401 ? "oauth_failed" : "Configuration"}`;
}
