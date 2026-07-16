// ---------------------------------------------------------------------------
// Server startup hook (Next.js 16 instrumentation).
//
// Starts the background job queue worker so enqueued jobs (doc-process,
// agent-run, index-cleanup) actually get consumed. Without this, jobs pile
// up in the queue and never run.
//
// The Node.js-specific shutdown logic (process.on / process.exit) lives in
// instrumentation-node.ts. Splitting it out is required because the Edge
// Runtime compiler type-checks this whole file even when the NEXT_RUNTIME
// guard prevents execution -- it still rejects process.on/process.exit as
// unsupported APIs.
// ---------------------------------------------------------------------------

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("./instrumentation-node");
}
