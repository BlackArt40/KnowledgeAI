// ---------------------------------------------------------------------------
// Local Storage Cleanup - removes orphaned temp files from the filesystem.
//
// Cleans up two categories of orphaned files:
//   1. .uploads/.chunks/{uploadId}/  - abandoned chunked upload sessions
//      (server crash, user disconnect, session TTL expiry)
//   2. .uploads/{kbId}/               - files for deleted KBs
//
// Triggered:
//   - Lazily: on each chunked upload init (cleanupOrphanedChunks only)
//   - Manually: POST /api/admin/cleanup (admin only)
//   - Cron: scripts/cleanup-temp-files.ts
//   - Periodically: setInterval every 1 hour (auto-started on first import)
//
// Only runs in local storage mode (no-op when S3 is configured).
// ---------------------------------------------------------------------------

import { promises as fs } from "fs";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), ".uploads");
const CHUNKS_DIR = path.join(UPLOAD_DIR, ".chunks");

/** Default TTL for orphaned files (7 days). */
const FILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupStats {
  orphanedChunkDirs: number;
  orphanedKbDirs: number;
  oldFiles: number;
  freedBytes: number;
  errors: number;
}

function emptyStats(): CleanupStats {
  return { orphanedChunkDirs: 0, orphanedKbDirs: 0, oldFiles: 0, freedBytes: 0, errors: 0 };
}

/** Get size of a file or directory (recursive). */
async function dirSize(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await dirSize(full);
      } else {
        const stat = await fs.stat(full);
        total += stat.size;
      }
    }
  } catch {
    // Directory doesn't exist or not accessible
  }
  return total;
}

/**
 * Clean up orphaned chunk directories (.uploads/.chunks/{uploadId}/).
 * A chunk directory is orphaned if no matching upload session exists.
 *
 * @param activeUploadIds Set of currently active upload IDs. If not provided,
 *   the function only removes directories older than FILE_TTL_MS.
 */
export async function cleanupOrphanedChunks(
  activeUploadIds?: Set<string>
): Promise<CleanupStats> {
  const stats = emptyStats();
  if (activeUploadIds === undefined) activeUploadIds = new Set();

  try {
    const entries = await fs.readdir(CHUNKS_DIR, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(CHUNKS_DIR, entry.name);
      const uploadId = entry.name;

      // Orphaned: no matching active session
      const isActive = activeUploadIds.has(uploadId);

      let isOld = false;
      try {
        const stat = await fs.stat(dirPath);
        isOld = now - stat.mtimeMs > FILE_TTL_MS;
      } catch {
        // Can't stat, skip
      }

      if (!isActive && isOld) {
        try {
          stats.freedBytes += await dirSize(dirPath);
          await fs.rm(dirPath, { recursive: true, force: true });
          stats.orphanedChunkDirs++;
        } catch {
          stats.errors++;
        }
      }
    }
  } catch {
    // .chunks dir doesn't exist - nothing to clean
  }

  return stats;
}

/**
 * Clean up orphaned KB directories (.uploads/{kbId}/).
 * A KB directory is orphaned if the KB no longer exists.
 *
 * @param activeKbIds Set of currently existing KB IDs.
 */
export async function cleanupOrphanedKbDirs(
  activeKbIds: Set<string>
): Promise<CleanupStats> {
  const stats = emptyStats();

  try {
    const entries = await fs.readdir(UPLOAD_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === ".chunks") continue; // skip chunk temp dir

      const kbId = entry.name;
      if (!activeKbIds.has(kbId)) {
        // KB no longer exists - orphaned files
        const dirPath = path.join(UPLOAD_DIR, kbId);
        try {
          stats.freedBytes += await dirSize(dirPath);
          await fs.rm(dirPath, { recursive: true, force: true });
          stats.orphanedKbDirs++;
        } catch {
          stats.errors++;
        }
      }
    }
  } catch {
    // .uploads dir doesn't exist
  }

  return stats;
}

/**
 * Clean up old files within KB directories.
 * Removes individual files older than FILE_TTL_MS.
 */
export async function cleanupOldFiles(): Promise<CleanupStats> {
  const stats = emptyStats();
  const now = Date.now();

  try {
    const entries = await fs.readdir(UPLOAD_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".chunks") continue;
      const kbDir = path.join(UPLOAD_DIR, entry.name);

      try {
        const files = await fs.readdir(kbDir, { withFileTypes: true });
        for (const file of files) {
          if (file.isDirectory()) continue;
          const filePath = path.join(kbDir, file.name);
          try {
            const stat = await fs.stat(filePath);
            if (now - stat.mtimeMs > FILE_TTL_MS) {
              stats.freedBytes += stat.size;
              await fs.unlink(filePath);
              stats.oldFiles++;
            }
          } catch {
            stats.errors++;
          }
        }
      } catch {
        // Can't read KB dir
      }
    }
  } catch {
    // .uploads dir doesn't exist
  }

  return stats;
}

/**
 * Run all cleanup tasks.
 * @param activeKbIds Set of currently existing KB IDs (for orphan detection).
 *   If not provided, KB orphan cleanup is skipped.
 * @param activeUploadIds Set of active upload IDs. If not provided,
 *   only old chunk dirs are removed.
 */
export async function runCleanup(
  activeKbIds?: Set<string>,
  activeUploadIds?: Set<string>
): Promise<CleanupStats> {
  const stats = emptyStats();

  // 1. Orphaned chunk directories
  const chunkStats = await cleanupOrphanedChunks(activeUploadIds);
  stats.orphanedChunkDirs += chunkStats.orphanedChunkDirs;
  stats.freedBytes += chunkStats.freedBytes;
  stats.errors += chunkStats.errors;

  // 2. Orphaned KB directories
  if (activeKbIds) {
    const kbStats = await cleanupOrphanedKbDirs(activeKbIds);
    stats.orphanedKbDirs += kbStats.orphanedKbDirs;
    stats.freedBytes += kbStats.freedBytes;
    stats.errors += kbStats.errors;
  }

  // 3. Old files within KB directories
  const fileStats = await cleanupOldFiles();
  stats.oldFiles += fileStats.oldFiles;
  stats.freedBytes += fileStats.freedBytes;
  stats.errors += fileStats.errors;

  return stats;
}

// ── Periodic cleanup timer ───────────────────────────────────────────────

const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
let _timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic cleanup timer (auto-runs every hour).
 * Safe to call multiple times - only starts one timer.
 * Only active in local storage mode.
 */
export function startCleanupTimer(): void {
  if (_timer) return;
  _timer = setInterval(async () => {
    try {
      const stats = await runCleanup();
      if (stats.orphanedChunkDirs + stats.orphanedKbDirs + stats.oldFiles > 0) {
        console.log(
          `[cleanup] Removed ${stats.orphanedChunkDirs} chunk dirs, ` +
          `${stats.orphanedKbDirs} KB dirs, ${stats.oldFiles} old files ` +
          `(${(stats.freedBytes / 1024 / 1024).toFixed(1)} MB freed)`
        );
      }
    } catch (err) {
      console.error("[cleanup] Periodic cleanup error:", err);
    }
  }, CLEANUP_INTERVAL);

  // Don't keep the process alive just for cleanup
  if (_timer.unref) _timer.unref();
}

/** Stop the periodic cleanup timer. */
export function stopCleanupTimer(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
