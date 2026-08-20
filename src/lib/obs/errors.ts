// ---------------------------------------------------------------------------
// Error reporting (P6-1): in-memory error ring + zero-dependency Sentry
// ingestion via the standard Envelope protocol.
//
// When `SENTRY_DSN` is set, every reportError posts a real envelope to
// Sentry (`POST {dsn}/api/{projectId}/envelope/` with X-Sentry-Auth); without
// a DSN it only records to the in-memory ring (demo fallback, same pattern as
// every other provider in this repo). No @sentry SDK is needed - the envelope
// format is a documented public protocol.
// ---------------------------------------------------------------------------

import { uid } from "@/lib/ids";

export interface ObsError {
  id: string;
  message: string;
  stack?: string;
  /** "client" | "server" | "queue" | route/file name */
  source: string;
  context?: string;
  tags?: Record<string, string>;
  createdAt: number;
}

const ERROR_CAP = 200;

declare global {
  var __KAI_ERROR_STORE__: ObsError[] | undefined;
}

function errors(): ObsError[] {  if (!globalThis.__KAI_ERROR_STORE__) globalThis.__KAI_ERROR_STORE__ = [];
  return globalThis.__KAI_ERROR_STORE__;
}

export function listErrors(limit = 50): ObsError[] {
  return errors().slice(0, limit);
}

/** Record an error + forward to Sentry when configured. Never throws. */
export function reportError(
  err: unknown,
  opts: { source?: string; context?: string; tags?: Record<string, string> } = {}
): ObsError {
  const message = err instanceof Error ? err.message : err instanceof String ? String(err) : typeof err === "string" ? err : "Unknown error";
  const stack = err instanceof Error ? err.stack : undefined;
  const record: ObsError = {
    id: uid("err"),
    message,
    stack,
    source: opts.source ?? "server",
    context: opts.context,
    tags: opts.tags,
    createdAt: Date.now(),
  };
  const list = errors();
  list.unshift(record);
  if (list.length > ERROR_CAP) list.length = ERROR_CAP;
  void sendToSentry(buildSentryEvent(record));
  return record;
}

// ── Sentry Envelope (zero-dependency) ─────────────────────────────────────

export interface SentryDsn {
  protocol: string;
  publicKey: string;
  host: string;
  projectId: string;
}

/** Parse `https://<publicKey>@<host>/<projectId>` (path may include /0). */
export function parseDsn(dsn: string): SentryDsn | null {
  try {
    const url = new URL(dsn);
    if (!url.username) return null;
    const parts = url.pathname.replace(/^\/+/, "").split("/");
    const projectId = parts[parts.length - 1];
    if (!projectId) return null;
    return { protocol: url.protocol.replace(":", ""), publicKey: url.username, host: url.host, projectId };
  } catch {
    return null;
  }
}

export interface SentryEvent {
  event_id: string;
  timestamp: string;
  platform: string;
  level: "error" | "warning" | "info";
  message?: string;
  exception?: {
    values: { type: string; value: string; stacktrace?: { frames: { filename: string; function?: string; lineno?: number; colno?: number }[] } }[];
  };
  tags?: Record<string, string>;
  extra?: Record<string, string>;
  contexts?: { runtime?: { name: string; version: string } };
  request?: { url?: string; method?: string };
}

interface ParsedFrame {
  filename: string;
  function: string;
  lineno: number;
  colno: number;
}

/** Crude stack-frame parse (`at fn (file:line:col)` / `at file:line:col`). */
function parseFrames(stack?: string): SentryEvent["exception"] | undefined {
  if (!stack) return undefined;
  const frames: ParsedFrame[] = stack
    .split("\n")
    .map((line) => {
      const m = line.match(/at\s+(?:(.+?)\s+\()?(?:.*?:\/\/)?([^()\s]+):(\d+):(\d+)\)?$/);
      if (!m) return null;
      return { filename: m[2] ?? "unknown", function: m[1], lineno: Number(m[3]), colno: Number(m[4]) };
    })
    .filter((f): f is ParsedFrame => f !== null)
    .slice(0, 20);
  if (frames.length === 0) return undefined;
  return { values: [{ type: "Error", value: stack.split("\n")[0] ?? "Error", stacktrace: { frames } }] };
}

export function buildSentryEvent(record: ObsError): SentryEvent {
  const event: SentryEvent = {
    event_id: randomUUIDHex(),
    timestamp: new Date(record.createdAt).toISOString(),
    platform: record.source === "client" ? "javascript" : "node",
    level: "error",
    message: record.message,
    exception: parseFrames(record.stack),
    tags: record.tags,
    extra: record.context ? { context: record.context, source: record.source } : { source: record.source },
    contexts: {
      runtime: {
        name: record.source === "client" ? "browser" : "node",
        version: process.version ?? "",
      },
    },
  };
  return event;
}

/** 32-char lowercase hex event id (Sentry requirement). */
function randomUUIDHex(): string {
  const uuid = globalThis.crypto.randomUUID();
  return uuid.replace(/-/g, "").slice(0, 32).padEnd(32, "0");
}

/** Serialize an envelope: two JSON lines (envelope header + event payload). */
export function buildEnvelope(event: SentryEvent, dsn: SentryDsn): string {
  const header = {
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
    dsn: `${dsn.protocol}://${dsn.publicKey}@${dsn.host}/${dsn.projectId}`,
  };
  return `${JSON.stringify(header)}\n${JSON.stringify(event)}`;
}

/**
 * POST an envelope to Sentry. Returns false when no DSN is configured or the
 * request fails (never throws - error reporting must not break the app).
 */
export async function sendToSentry(event: SentryEvent, dsnOverride?: string): Promise<boolean> {
  const dsn = dsnOverride ?? process.env.SENTRY_DSN;
  if (!dsn) return false;
  const parsed = parseDsn(dsn);
  if (!parsed) return false;
  try {
    const res = await fetch(`${parsed.protocol}://${parsed.host}/api/${parsed.projectId}/envelope/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=knowledgeai-obs/1.0`,
      },
      body: buildEnvelope(event, parsed),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok || res.status === 429; // 429 = accepted for rate limiting
  } catch {
    return false;
  }
}
