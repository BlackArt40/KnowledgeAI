// @ts-nocheck
// Standalone cleanup script for orphaned temp files.
// Can be run via cron: 0 * * * * cd /app && node --import tsx scripts/cleanup-temp-files.ts
//
// Usage:
//   node --import tsx scripts/cleanup-temp-files.ts
//   DATABASE_URL=... node --import tsx scripts/cleanup-temp-files.ts  # hydrate KBs from DB first

import { promises as fs } from "fs";
import path from "path";

async function main() {
  console.log("[cleanup] Starting temp file cleanup...");

  // Hydrate from DB if available (to know which KBs exist)
  if (process.env.DATABASE_URL) {
    console.log("[cleanup] Hydrating from database...");
    const { ensureHydrated } = await import("../src/lib/db/hydrate");
    await ensureHydrated();
    await new Promise((r) => setTimeout(r, 500));
  }

  const { listAllKbs } = await import("../src/lib/kb/store");
  const { getActiveUploadIds } = await import("../src/lib/upload/store");
  const { runCleanup } = await import("../src/lib/storage/cleanup");

  const activeKbIds = new Set(listAllKbs().map((kb: any) => kb.id));
  const activeUploadIds = getActiveUploadIds();

  console.log(`[cleanup] Active KBs: ${activeKbIds.size}, Active uploads: ${activeUploadIds.size}`);

  const stats = await runCleanup(activeKbIds, activeUploadIds);

  console.log(`[cleanup] ✅ Done:`);
  console.log(`  Orphaned chunk dirs: ${stats.orphanedChunkDirs}`);
  console.log(`  Orphaned KB dirs:    ${stats.orphanedKbDirs}`);
  console.log(`  Old files:           ${stats.oldFiles}`);
  console.log(`  Freed:               ${(stats.freedBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Errors:              ${stats.errors}`);
}

main().catch((err) => {
  console.error("[cleanup] ❌ Error:", err);
  process.exit(1);
});
