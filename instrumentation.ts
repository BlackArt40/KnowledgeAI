// ---------------------------------------------------------------------------
// Server startup hook (Next.js 16 instrumentation).
//
// Starts the background job queue worker so enqueued jobs (doc-process,
// agent-run, index-cleanup) actually get consumed. Without this, jobs pile
// up in the queue and never run.
//
// The Node.js-only body (process.on / process.exit, queue + storage imports)
// lives in instrumentation-node.ts and is imported dynamically below. Why the
// split: Next compiles an Edge variant of this file too, and Node-only APIs in
// its module graph produce "not supported in the Edge Runtime" warnings for
// `[Edge Instrumentation]` (process.cwd via queue -> storage, pino, ...).
// Verified 2026-11-26: inlining the body still lets `next build` exit 0, but
// floods the build with ~32 Edge-runtime traces, so the split stays.
// ---------------------------------------------------------------------------

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await import("./instrumentation-node");
}
