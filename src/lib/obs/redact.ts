// ---------------------------------------------------------------------------
// Redaction helpers (P6-2): mask sensitive shapes inside free-form text.
//
// Pure Web-API module (no Node imports) so it can run everywhere: the Node
// runtime (log.ts), the Edge runtime (log-edge.ts) and the browser
// (log-browser.ts). pino's `redact` option censors structured fields by key
// path; this file handles the free-text cases (provider error bodies, error
// messages, URLs) that key-path redaction cannot reach.
// ---------------------------------------------------------------------------

export const REDACT_TEXT_MAX = 500;

/** Serialize any value without throwing (circular refs fall back to String). */
export function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Cap a string at maxLen with an ellipsis marker. */
export function truncate(s: string, maxLen = REDACT_TEXT_MAX): string {
  return s.length > maxLen ? `${s.slice(0, maxLen)}…(truncated)` : s;
}

/**
 * Mask common secret shapes in free text: sk-/pk- API keys, Bearer tokens,
 * `key=value` / `key: value` assignments of sensitive names, and
 * `user:pass@` in URLs. Truncates the result to maxLen.
 */
export function redactText(input: unknown, maxLen = REDACT_TEXT_MAX): string {
  const s = safeString(input);
  const masked = s
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}\b/g, "$1-***")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer ***")
    .replace(
      /\b(api[_-]?key|password|passwd|secret|token|authorization|private[_-]?key|client[_-]?secret)\b(\s*[:=]\s*)(?!Bearer\b)([^\s"']{6,})/gi,
      "$1$2***"
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1***@");
  return truncate(masked, maxLen);
}
