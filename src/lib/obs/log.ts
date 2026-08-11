// ---------------------------------------------------------------------------
// Structured logging (P6-2): pino singleton for the Node runtime.
//
// One JSON line per log event, written to stdout and - when LOG_LOKI_URL is
// set - batched to a Loki HTTP Push endpoint. Levels come from LOG_LEVEL
// (debug|info|warn|error, default info). Every line emitted inside a traced
// request automatically carries `requestId` (== X-Trace-Id) via pino's
// `mixin` hook reading the AsyncLocalStorage trace context. Sensitive fields
// (apiKey/password/token/... incl. nested) are censored by pino `redact`;
// free-text values (provider error bodies etc.) must pass redactText() at the
// call site - key-path redaction cannot reach inside strings. Recent lines
// are kept in a bounded in-memory ring (`__KAI_LOG_STORE__`) served by
// GET /api/admin/logs.
//
// Why pino (the ROADMAP plan named pino/winston): pino is dependency-light,
// fast, and its JSON output + level + redact options map 1:1 onto the P6-2
// acceptance criteria. The Edge runtime cannot import it (node:stream), so
// the proxy logs through log-edge.ts (same JSON shape, Web-API only), and
// the browser through log-browser.ts (pino/browser).
// ---------------------------------------------------------------------------

import { Writable } from "node:stream";
import pino from "pino";
import { currentTraceCtx } from "./context";
import { redactText, truncate } from "./redact";

export { redactText, truncate };

export const REDACT_CENSOR = "***";

const LOG_CAP = 1000; // ring cap (newest first)
const LOKI_FLUSH_MS = 2000; // max batch age before push
const LOKI_MAX_BATCH = 100; // max lines per push
const LOKI_TIMEOUT_MS = 5000;

/** Sensitive key names censored by pino redact. fast-redact has no `**` deep
 *  wildcard, so each key gets exact + one/two-level wildcard paths (verified
 *  against pino 10 - `*.*.key` matches `a.b.key`). */
const SENSITIVE_KEYS = [
  "apiKey", "api_key", "apikey",
  "secret", "clientSecret", "client_secret", "secretKey", "secret_key",
  "password", "passwd", "pwd",
  "token", "accessToken", "refreshToken", "authToken", "idToken", "tokens",
  "authorization", "credential", "credentials",
  "cookie", "cookies",
  "x-api-key", "x-auth-token",
  "privateKey", "private_key",
  "bearer",
];

const LEVEL_VALUES: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

function redactPaths(): string[] {
  const paths: string[] = [];
  for (const key of SENSITIVE_KEYS) paths.push(key, `*.${key}`, `*.*.${key}`);
  // LOG_REDACT_KEYS: extra comma-separated pino redact paths (e.g. "headers.cookie,team.inviteLink")
  for (const extra of (process.env.LOG_REDACT_KEYS ?? "").split(",")) {
    const t = extra.trim();
    if (t) paths.push(t);
  }
  return paths;
}

function parseLevel(raw: string | undefined): pino.LevelWithSilent {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "debug" || v === "info" || v === "warn" || v === "error" || v === "fatal" || v === "trace" || v === "silent"
    ? (v as pino.LevelWithSilent)
    : "info";
}

/** Loki push endpoint (lazily read per flush - unset means stdout only with
 *  zero network). Trailing slashes are stripped. */
export function lokiUrl(): string {
  return (process.env.LOG_LOKI_URL ?? "").trim().replace(/\/+$/, "");
}

export function isLokiEnabled(): boolean {
  return lokiUrl().length > 0;
}

export interface LogEntry {
  ts: number;
  level: string;
  msg: string;
  requestId?: string;
  [key: string]: unknown;
}

declare global {
  var __KAI_LOG_STORE__: LogEntry[] | undefined;
}

function ring(): LogEntry[] {
  if (!globalThis.__KAI_LOG_STORE__) globalThis.__KAI_LOG_STORE__ = [];
  return globalThis.__KAI_LOG_STORE__;
}

function pushRing(entry: LogEntry): void {
  const r = ring();
  r.unshift(entry);
  if (r.length > LOG_CAP) r.length = LOG_CAP;
}

/** Filter + slice the recent-log ring for GET /api/admin/logs. */
export function recentLogs(
  opts: { level?: string; requestId?: string; limit?: number } = {}
): LogEntry[] {
  const { level, requestId, limit = 200 } = opts;
  const min = level ? LEVEL_VALUES[level.toLowerCase()] : undefined;
  let list = ring();
  if (min !== undefined) list = list.filter((e) => (LEVEL_VALUES[e.level] ?? 0) >= min);
  if (requestId) list = list.filter((e) => e.requestId === requestId);
  return list.slice(0, Math.max(1, Math.min(limit, 500)));
}

/**
 * pino destination: tees every line to stdout, keeps the recent ring, and
 * batches to Loki (LOG_LOKI_URL read lazily per flush). Loki failures are
 * dropped and counted, never thrown - logging must not break the app.
 */
class ObsDestination extends Writable {
  private batch: { ts: string; line: string }[] = [];
  private flushing = false;
  private lokiFailures = 0;

  constructor() {
    super();
  }

  private fail(reason: string): void {
    this.lokiFailures++;
    if (this.lokiFailures === 1 || this.lokiFailures % 20 === 0) {
      // Direct stdout write (not through pino) - avoids recursion into _write.
      try {
        process.stdout.write(
          JSON.stringify({
            level: "warn",
            msg: "[loki] push failed, logs dropped",
            reason,
            failures: this.lokiFailures,
            ts: Date.now(),
          }) + "\n"
        );
      } catch {
        /* stdout may be gone during shutdown */
      }
    }
  }

  _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    try {
      let line = chunk.toString();
      let obj: Record<string, unknown> | null = null;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        /* keep raw line */
      }
      if (obj) {
        const levelNum = typeof obj.level === "number" ? obj.level : 30;
        const name = (pino.levels.labels as Record<number, string>)[levelNum] ?? "info";
        const entry: LogEntry = {
          ts: typeof obj.time === "number" ? obj.time : Date.now(),
          level: name,
          msg: typeof obj.msg === "string" ? obj.msg : "",
        };
        for (const [k, v] of Object.entries(obj)) {
          if (k !== "time" && k !== "level" && k !== "msg") entry[k] = v;
        }
        pushRing(entry);
      }
      if (!line.endsWith("\n")) line += "\n";
      process.stdout.write(line);
      if (lokiUrl()) {
        this.batch.push({ ts: String(Date.now() * 1_000_000), line: line.trim() });
        if (this.batch.length >= LOKI_MAX_BATCH) void this.drain();
      }
      cb();
    } catch (err) {
      cb(err instanceof Error ? err : new Error(String(err)));
    }
  }

  draining(): boolean {
    return this.flushing;
  }

  /** Push the pending batch to Loki (best effort, never throws). */
  async drain(): Promise<void> {
    while (this.flushing) await new Promise((r) => setTimeout(r, 5));
    if (this.batch.length === 0) return;
    this.flushing = true;
    const batch = this.batch;
    this.batch = [];
    try {
      const url = lokiUrl();
      if (url) {
        const res = await fetch(`${url}/loki/api/v1/push`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            streams: [
              {
                stream: { app: "knowledgeai", env: process.env.NODE_ENV ?? "dev" },
                values: batch.map((b) => [b.ts, b.line]),
              },
            ],
          }),
          signal: AbortSignal.timeout(LOKI_TIMEOUT_MS),
        });
        if (!res.ok) this.fail(`HTTP ${res.status}`);
      }
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    } finally {
      this.flushing = false;
      if (this.batch.length > 0) void this.drain(); // keep draining arrivals
    }
  }
}

const dest = new ObsDestination();

export const log: pino.Logger = pino(
  {
    level: parseLevel(process.env.LOG_LEVEL),
    // Correlate every line with the current request: inside a traced request
    // the ALS context holds the trace id (== X-Trace-Id from the proxy).
    mixin: () => {
      const ctx = currentTraceCtx();
      return ctx ? { requestId: ctx.traceId } : {};
    },
    redact: { paths: redactPaths(), censor: REDACT_CENSOR },
  },
  dest
);

// Periodic Loki flush. Guarded on globalThis so dev HMR doesn't stack timers.
declare global {
  var __KAI_LOG_INTERVAL__: NodeJS.Timeout | undefined;
}
if (globalThis.__KAI_LOG_INTERVAL__) clearInterval(globalThis.__KAI_LOG_INTERVAL__);
globalThis.__KAI_LOG_INTERVAL__ = setInterval(() => {
  void dest.drain();
}, LOKI_FLUSH_MS);
globalThis.__KAI_LOG_INTERVAL__.unref?.();

/** Change the runtime log level (used by tests and ops). */
export function setLogLevel(level: string): void {
  log.level = parseLevel(level);
}

export function getLogLevel(): string {
  return typeof log.level === "string" ? log.level : "info";
}

/** Wait for the pending Loki batch (and any in-flight push) to settle. */
export async function flushLogs(): Promise<void> {
  while (dest.draining()) await new Promise((r) => setTimeout(r, 5));
  await dest.drain();
  while (dest.draining()) await new Promise((r) => setTimeout(r, 5));
}
