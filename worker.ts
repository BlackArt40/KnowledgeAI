// ---------------------------------------------------------------------------
// Worker process entrypoint.
//
// Runs the background job queue consumer as a standalone process, separate
// from the Next.js web server. Started by `docker-compose.yml`'s worker
// service via `node worker.js`.
//
// Responsibilities:
//   1. Connect to Redis (REDIS_URL must be set).
//   2. Register all job handlers (doc-process, agent-run, index-cleanup).
//   3. Start consuming jobs from the BullMQ queue.
//   4. Keep the process alive until SIGTERM/SIGINT.
//
// In memory mode (no REDIS_URL) this process is unnecessary -- the web
// process runs an in-process MemoryQueue via instrumentation.ts. But this
// entrypoint still works: it logs a warning and exits, since there's no
// Redis queue to consume from.
// ---------------------------------------------------------------------------

import { startQueue, stopQueue, isQueueExternal } from "@/lib/queue";

async function main() {
  if (!isQueueExternal()) {
    console.warn("[worker] REDIS_URL not set. Worker process is only useful with BullMQ (Redis). Exiting.");
    process.exit(0);
  }

  console.log("[worker] Starting background queue worker...");
  startQueue();
  console.log("[worker] Worker ready, waiting for jobs.");

  const shutdown = async (sig: string) => {
    console.log(`[worker] Received ${sig}, shutting down...`);
    try {
      await stopQueue();
    } catch (err) {
      console.error("[worker] Error during shutdown:", err);
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] Fatal startup error:", err);
  process.exit(1);
});
