"use client";

import * as React from "react";

// P6-1: global client-side error reporter. Captures window `error` +
// `unhandledrejection`, throttles (max 1 per 3s, 20 per session) and POSTs to
// /api/obs/report - the server records it and forwards to Sentry when
// SENTRY_DSN is configured. Mounted once in the root layout.
export function ErrorReporter() {
  const reported = React.useRef(0);
  const lastSent = React.useRef(0);

  React.useEffect(() => {
    const send = (payload: { message: string; stack?: string; source: string; url?: string }) => {
      const now = Date.now();
      // Throttle bursts (e.g. a loop throwing 1000 errors on a broken page).
      if (now - lastSent.current < 3000 || reported.current >= 20) return;
      lastSent.current = now;
      reported.current++;
      void fetch("/api/obs/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    };

    const onError = (e: ErrorEvent) => {
      send({ message: e.message || "Unknown client error", stack: e.error?.stack, source: "window.onerror", url: window.location.href });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      send({
        message: reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Unhandled promise rejection",
        stack: reason instanceof Error ? reason.stack : undefined,
        source: "unhandledrejection",
        url: window.location.href,
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
