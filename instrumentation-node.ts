// ---------------------------------------------------------------------------
// Node.js-only instrumentation entrypoint.
//
// Imported by instrumentation.ts only when NEXT_RUNTIME === "nodejs". Keeps
// process.on / process.exit out of the Edge-compiled instrumentation.ts so
// the Edge Runtime compiler doesn't reject them.
// ---------------------------------------------------------------------------

import { startQueue, stopQueue } from "@/lib/queue";

console.log("[instrumentation] Starting background queue worker...");
startQueue();

const shutdown = async () => {
  console.log("[instrumentation] Shutting down queue worker...");
  try {
    await stopQueue();
  } catch {
    // ignore -- best-effort cleanup
  }
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
