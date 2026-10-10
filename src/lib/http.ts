// ---------------------------------------------------------------------------
// Client-side fetch helpers.
//
// API routes answer non-OK requests with a JSON error body ({ error: ... };
// 429 adds retryAfter/dimension). Callers that feed the parsed body straight
// into render state assume the success shape - an error body leaves the fields
// undefined and the next render crashes (`x.map` of undefined), blanking the
// page behind the 500 boundary (observed in CI when rate limits tripped).
// fetchJson() returns null instead, so callers can keep their previous state.
// ---------------------------------------------------------------------------

/** fetch + `r.ok` guard + JSON parse.
 *  Returns null for a non-OK response, a network failure, or an unparseable
 *  body - never the error payload. */
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(input, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
