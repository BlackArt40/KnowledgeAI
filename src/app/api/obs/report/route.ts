import { NextResponse } from "next/server";
import { reportError, buildSentryEvent } from "@/lib/obs/errors";
import { sendToSentry } from "@/lib/obs/errors";

export const dynamic = "force-dynamic";

// POST /api/obs/report - client-side error intake (P6-1).
// Body: { message, stack?, source?, url?, tags? }
// Records the error in the in-memory ring and forwards it to Sentry when
// SENTRY_DSN is configured. Anonymous by design (errors are telemetry); the
// proxy rate limit still applies (best-effort - the client reporter throttles).
export async function POST(req: Request) {
  let body: { message?: string; stack?: string; source?: string; url?: string; tags?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.message?.trim()) {
    return NextResponse.json({ error: "message 必填" }, { status: 400 });
  }
  const err = new Error(body.message.slice(0, 2000));
  if (body.stack) err.stack = body.stack.slice(0, 8000);
  // P2: bound every client-controlled field before it enters the error ring /
  // Sentry (log-injection and quota-exhaustion surface).
  const rawTags = body.tags && typeof body.tags === "object" ? body.tags : {};
  const tags = Object.fromEntries(
    Object.entries(rawTags)
      .filter(([, v]) => typeof v === "string")
      .slice(0, 20)
      .map(([k, v]) => [k.slice(0, 50), String(v).slice(0, 200)])
  );
  const record = reportError(err, {
    source: "client",
    context: typeof body.url === "string" ? `url: ${body.url.slice(0, 2000)}` : undefined,
    tags,
  });
  // Forward to Sentry with a browser platform tag (reportError defaulted to
  // "node" for server-side source strings; client events must say javascript).
  void sendToSentry({ ...buildSentryEvent(record), platform: "javascript" });
  return NextResponse.json({ ok: true, id: record.id });
}
