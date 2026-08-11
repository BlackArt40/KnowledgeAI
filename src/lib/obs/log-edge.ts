// ---------------------------------------------------------------------------
// Edge-safe structured logger (P6-2): JSON lines for the Next.js proxy.
//
// The Edge runtime cannot import pino (node:stream) or node:crypto, so the
// proxy emits the same JSON shape by hand over console. This is the ONLY
// file in the repo allowed to call console.* (asserted by
// scripts/smoke/test-logging.ts). Request correlation is explicit here: the
// proxy mints/propagates the trace id, so call sites pass it as `requestId`.
// ---------------------------------------------------------------------------

type EdgeLevel = "info" | "warn" | "error";

export interface EdgeFields {
  [key: string]: unknown;
}

function emit(level: EdgeLevel, fields: EdgeFields, msg: string): void {
  const line = JSON.stringify({ level, msg, ts: Date.now(), ...fields });
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  fn(line);
}

/** (msg, fields) - pino-compatible positional style for proxy call sites. */
export const logEdge = {
  info: (msg: string, fields: EdgeFields = {}): void => emit("info", fields, msg),
  warn: (msg: string, fields: EdgeFields = {}): void => emit("warn", fields, msg),
  error: (msg: string, fields: EdgeFields = {}): void => emit("error", fields, msg),
};
