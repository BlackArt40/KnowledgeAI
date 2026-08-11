// @ts-nocheck
// P6-1 acceptance verification: zero-dependency Sentry envelope ingestion.
//   - parseDsn handles valid/invalid DSNs
//   - buildEnvelope produces the two-line envelope (header + event)
//   - sendToSentry POSTs a real envelope with the X-Sentry-Auth header to a
//     local receiver (simulating the Sentry endpoint); 429 is treated as OK
//   - without SENTRY_DSN nothing is sent
//   - reportError records to the in-memory ring and forwards (DSN-gated)
// Pure-lib test (test-2fa pattern) - no dev server needed.
// Run: npx tsx scripts/smoke/test-sentry.ts

import { createServer } from "node:http";
import { reportError, parseDsn, buildEnvelope, buildSentryEvent, sendToSentry, listErrors } from "../../src/lib/obs/errors";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let failures = 0;
  const results = [];
  function check(name, cond, detail = "") {
    if (cond) results.push(`✅ ${name}`);
    else { results.push(`❌ ${name} ${detail}`); failures++; }
  }

  // ── 1. parseDsn ───────────────────────────────────────────────────────
  console.log("\n── 1. parseDsn ──");
  const dsn = parseDsn("https://abc123def@o123456.ingest.sentry.io/4500000000000000");
  check("parseDsn: host parsed", dsn?.host === "o123456.ingest.sentry.io", JSON.stringify(dsn));
  check("parseDsn: key parsed", dsn?.publicKey === "abc123def");
  check("parseDsn: projectId parsed", dsn?.projectId === "4500000000000000");
  check("parseDsn: protocol parsed", dsn?.protocol === "https");
  check("parseDsn: invalid dsn -> null", parseDsn("not-a-url") === null);
  check("parseDsn: missing key -> null", parseDsn("https://o1.sentry.io/123") === null);

  // ── 2. envelope structure ─────────────────────────────────────────────
  console.log("\n── 2. buildEnvelope ──");
  const event = buildSentryEvent({
    id: "err_test",
    message: "boom",
    stack: "Error: boom\n    at main (file:///app/route.ts:12:5)",
    source: "server",
    createdAt: Date.now(),
  });
  const envelope = buildEnvelope(event, dsn);
  const [headerLine, eventLine] = envelope.split("\n");
  const header = JSON.parse(headerLine);
  const payload = JSON.parse(eventLine);
  check("envelope: two JSON lines", !!headerLine && !!eventLine);
  check("envelope: header carries dsn + event_id", header.dsn?.includes("4500000000000000") && header.event_id === event.event_id);
  check("envelope: event platform node", payload.platform === "node");
  check("envelope: event_id is 32 hex chars", /^[0-9a-f]{32}$/.test(payload.event_id), payload.event_id);
  check("envelope: exception value parsed", payload.exception?.values?.[0]?.value === "Error: boom");
  check("envelope: stacktrace frames parsed", payload.exception?.values?.[0]?.stacktrace?.frames?.some((f) => f.filename?.includes("route.ts")), JSON.stringify(payload.exception?.values?.[0]?.stacktrace?.frames));
  const clientEvent = buildSentryEvent({ id: "err2", message: "ui boom", source: "client", createdAt: Date.now() });
  check("client event: platform javascript", clientEvent.platform === "javascript");

  // ── 3. real delivery to a local receiver ──────────────────────────────
  console.log("\n── 3. sendToSentry (local receiver) ──");
  const received = [];
  const receiver = createServer((req2, res2) => {
    let body = "";
    req2.on("data", (c) => { body += c; });
    req2.on("end", () => {
      received.push({ url: req2.url, auth: req2.headers["x-sentry-auth"], contentType: req2.headers["content-type"], body });
      res2.writeHead(200);
      res2.end();
    });
  });
  await new Promise((r) => receiver.listen(0, "127.0.0.1", r));
  const port = receiver.address().port;
  const localDsn = `http://localkey@127.0.0.1:${port}/999`;

  const sent = await sendToSentry(event, localDsn);
  check("sendToSentry: returns true", sent === true);
  await sleep(200);
  check("receiver: got the envelope POST", received.length === 1, `n=${received.length}`);
  const got = received[0];
  check("receiver: URL is /api/999/envelope/", got?.url === "/api/999/envelope/", got?.url);
  check("receiver: X-Sentry-Auth header", /sentry_version=7/.test(got?.auth ?? "") && /sentry_key=localkey/.test(got?.auth ?? ""), got?.auth);
  check("receiver: content-type envelope", got?.contentType === "application/x-sentry-envelope", got?.contentType);
  const recvEvent = JSON.parse(got?.body?.split("\n")?.[1] ?? "{}");
  check("receiver: event payload intact", recvEvent.event_id === event.event_id && recvEvent.exception?.values?.[0]?.value === "Error: boom");

  // 429 treated as accepted
  const received2 = [];
  const rlReceiver = createServer((req2, res2) => {
    req2.resume();
    req2.on("end", () => { received2.push(req2.url); res2.writeHead(429); res2.end(); });
  });
  await new Promise((r) => rlReceiver.listen(0, "127.0.0.1", r));
  const sent2 = await sendToSentry(event, `http://k@127.0.0.1:${rlReceiver.address().port}/1`);
  check("sendToSentry: 429 treated as accepted", sent2 === true);
  await sleep(100);
  await new Promise((r) => rlReceiver.close(r));

  // ── 4. no DSN -> no network ───────────────────────────────────────────
  console.log("\n── 4. 无 DSN 门控 ──");
  const before = received.length;
  const sent3 = await sendToSentry(event); // no env DSN set in this test process
  check("no DSN: sendToSentry returns false", sent3 === false);
  await sleep(100);
  check("no DSN: nothing posted", received.length === before);
  const err = reportError(new Error("local ring error"), { source: "test" });
  check("reportError: returns record", err.message === "local ring error");
  check("reportError: recorded in ring", listErrors(10).some((e) => e.id === err.id));
  await new Promise((r) => receiver.close(r));

  console.log(`\n${results.join("\n")}`);
  console.log(`\nSentry envelope acceptance: ${results.length - failures}/${results.length} passed${failures ? `, ${failures} FAILED` : ""}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
