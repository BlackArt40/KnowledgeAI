/** P7-2 / L-1 / F17: CORS for the header-auth public API.
 *
 *  L-1: reflect the Origin only when it's on the allowlist
 *  (CORS_ALLOWED_ORIGINS, comma-separated), and always send Vary: Origin so a
 *  shared CDN cache can't poison a cross-origin response onto a same-origin
 *  request.
 *
 *  F17: with no allowlist configured this used to reflect ANY Origin, in
 *  production too - an operator who never opted into cross-origin access still
 *  advertised it. The rules are now:
 *    - Origin listed in CORS_ALLOWED_ORIGINS -> reflect it;
 *    - no allowlist AND not production       -> reflect it (dev / widget);
 *    - no allowlist AND production           -> omit the header (browser blocks);
 *    - allowlist set but Origin not listed   -> omit the header.
 *  Omitting Access-Control-Allow-Origin is the deny path: the preflight fails
 *  and the browser never issues the real request. Previously the "denied"
 *  branch returned `allowed[0]` - a different origin entirely.
 *
 *  Extracted from src/proxy.ts so the rules are unit-testable under src/lib
 *  (see cors.test.ts; the infra smoke suite only covers them end-to-end).
 *  Keep this module edge-safe: no Node APIs. */
export function corsHeaders(origin: string): Record<string, string> {
  const allowed = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const mayReflect =
    allowed.includes(origin) ||
    (allowed.length === 0 && process.env.NODE_ENV !== "production");

  const headers: Record<string, string> = {
    // L-1: prevent cache poisoning - the response varies by Origin.
    Vary: "Origin",
  };
  if (!mayReflect) return headers;

  headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Trace-Id, X-KAI-Required-Scope";
  headers["Access-Control-Max-Age"] = "86400";
  return headers;
}
