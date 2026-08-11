// ---------------------------------------------------------------------------
// Browser structured logger (P6-2): pino/browser for client-side console
// output (JSON-shaped objects instead of ad-hoc console.error calls).
//
// pino/browser has no `redact` support, so client call sites must not pass
// sensitive values - the three converted sites (admin config error, error
// boundary, SW registration) only log status codes / messages.
// ---------------------------------------------------------------------------

import pino from "pino/browser";

export const clientLog = pino({ level: "info", browser: { asObject: true } });
