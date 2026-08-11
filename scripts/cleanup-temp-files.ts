// @ts-nocheck
// Standalone cleanup script for orphaned temp files.
// Can be run via cron: 0 * * * * cd /app && node --import tsx scripts/cleanup-temp-files.ts
//
// Usage:
//   node --import tsx scripts/cleanup-temp-files.ts
//   DATABASE_URL=... node --import tsx scripts/cleanup-temp-files.ts  # hydrate KBs from DB first

import { promises as fs } from "fs";
import path from "path";
import { log } from "../src/lib/obs/log";

async function main() {
  log.info("[cleanup] Starting temp file cleanup...");

  // Hydrate from DB if available (to know which KBs exist)
  if (process.env.DATABASE_URL) {
    log.info("[cleanup] Hydrating from database...");
    const { ensureHydrated } = await import("../src/lib/db/hydrate");
    await ensureHydrated();
    await new Promise((r) => setTimeout(r, 500));
  }

  const { listAllKbs } = await import("../src/lib/kb/store");
  const { getActiveUploadIds } = await import("../src/lib/upload/store");
  const { runCleanup } = await import("../src/lib/storage/cleanup");

  const activeKbIds = new Set(listAllKbs().map((kb: any) => kb.id));
  const activeUploadIds = getActiveUploadIds();

  log.info(`[cleanup] Active KBs: ${activeKbIds.size}, Active uploads: ${activeUploadIds.size}`);

  const stats = await runCleanup(activeKbIds, activeUploadIds);

  log.info(`[cleanup] ✅ Done:`);
  log.info(`  Orphaned chunk dirs: ${stats.orphanedChunkDirs}`);
  log.info(`  Orphaned KB dirs:    ${stats.orphanedKbDirs}`);
  log.info(`  Old files:           ${stats.oldFiles}`);
  log.info(`  Freed:               ${(stats.freedBytes / 1024 / 1024).toFixed(2)} MB`);
  log.info(`  Errors:              ${stats.errors}`);
}

main().catch((err) => {
  log.error({ err }, "[cleanup] ❌ Error");
  process.exit(1);
});
