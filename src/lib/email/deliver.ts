// ---------------------------------------------------------------------------
// P8 · Shared helpers for the auth email flows (forgot-password, register,
// verify-email/resend). The three routes used to copy the same three steps:
// build the action link, branch on demo mode, enqueue the email-send job.
// This module is that shape, once.
//
// Link base: NEXT_PUBLIC_APP_URL is the repo's existing public-origin
// convention (billing/provider.ts); behind a reverse proxy `req.url` may
// carry an internal origin, so the env var is the deployment override.
// ---------------------------------------------------------------------------

import { log } from "@/lib/obs/log";

/** Absolute URL for an auth action link (`/reset-password`, `/verify-email`). */
export function authLink(req: Request, path: string, token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  return `${base.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;
}

/**
 * Enqueue a transactional email for background delivery. Fire-and-forget:
 * the queue handler performs ONE send attempt per attempt and the queue
 * retries transient failures (3 attempts, exponential backoff) before
 * dead-lettering. Never blocks or rejects into the request path.
 */
export function enqueueEmailSend(payload: { to: string; url: string; kind: "reset" | "verify" }): void {
  void import("@/lib/queue")
    .then(async ({ enqueue }) => {
      const { currentTraceCtx } = await import("@/lib/obs/context");
      const traceId = currentTraceCtx()?.traceId;
      await enqueue("email-send", { ...payload, ...(traceId ? { traceId } : {}) });
    })
    .catch((err) => {
      log.error({ err }, "[auth] failed to enqueue email-send");
    });
}

/**
 * Whether demo links may be returned in API responses. In production a
 * response carrying the link for an existing account and a generic one for
 * an unknown account IS a user-enumeration oracle, so production always
 * gets the uniform response - configure a mailer to enable the flow there.
 */
export function demoLinksAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}
