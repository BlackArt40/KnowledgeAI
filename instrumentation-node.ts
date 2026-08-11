// ---------------------------------------------------------------------------
// Node.js-only instrumentation entrypoint.
//
// Imported by instrumentation.ts only when NEXT_RUNTIME === "nodejs". Keeps
// process.on / process.exit out of the Edge-compiled instrumentation.ts so
// the Edge Runtime compiler doesn't reject them.
// ---------------------------------------------------------------------------

import { startQueue, stopQueue } from "@/lib/queue";
import { log } from "./src/lib/obs/log";

log.info("[instrumentation] Starting background queue worker...");
startQueue();

const shutdown = async () => {
  log.info("[instrumentation] Shutting down queue worker...");
  try {
    await stopQueue();
  } catch {
    // ignore -- best-effort cleanup
  }
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
