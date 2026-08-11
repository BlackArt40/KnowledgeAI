"use client";
// P5-1: registers the hand-written service worker (/sw.js) for offline
// access to already-loaded content. Only registers in production builds -
// in dev, caching would fight Next.js HMR / fast refresh.
import * as React from "react";
import { clientLog } from "@/lib/obs/log-browser";

export function SwRegister() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err: unknown) => {
        // Non-fatal: the app works without offline support.
        clientLog.warn({ err: err instanceof Error ? err.message : String(err) }, "[PWA] service worker registration failed");
      });
  }, []);

  return null;
}
