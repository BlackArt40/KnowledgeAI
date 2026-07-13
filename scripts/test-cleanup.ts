// @ts-nocheck
// Test for local storage cleanup module.
import { promises as fs } from "fs";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), ".uploads");
const CHUNKS_DIR = path.join(UPLOAD_DIR, ".chunks");
const OLD_TIME = Date.now() / 1000 - 8 * 24 * 60 * 60; // 8 days ago (mtime in seconds)

async function touchOld(filePath: string) {
  await fs.utimes(filePath, OLD_TIME, OLD_TIME);
}

async function main() {
  const { runCleanup, cleanupOrphanedChunks, cleanupOrphanedKbDirs } = await import("../src/lib/storage/cleanup");

  let pass = 0, fail = 0;
  const check = (label: string, ok: boolean) => {
    console.log(`  ${ok ? "✅" : "❌"} ${label}`);
    ok ? pass++ : fail++;
  };

  console.log("[cleanup] Setting up test data...\n");

  // 1. Create orphaned chunk dir (no matching upload session)
  const orphanChunkDir = path.join(CHUNKS_DIR, "orphan-upload-id");
  await fs.mkdir(orphanChunkDir, { recursive: true });
  await fs.writeFile(path.join(orphanChunkDir, "0"), Buffer.alloc(1024));
  await touchOld(orphanChunkDir);
  await touchOld(path.join(orphanChunkDir, "0"));

  // 2. Create "active" chunk dir (should NOT be removed)
  const activeChunkDir = path.join(CHUNKS_DIR, "active-upload-id");
  await fs.mkdir(activeChunkDir, { recursive: true });
  await fs.writeFile(path.join(activeChunkDir, "0"), Buffer.alloc(512));
  await touchOld(activeChunkDir);

  // 3. Create orphaned KB dir (KB doesn't exist)
  const orphanKbDir = path.join(UPLOAD_DIR, "kb_nonexistent_orphan");
  await fs.mkdir(orphanKbDir, { recursive: true });
  await fs.writeFile(path.join(orphanKbDir, "old-file.txt"), Buffer.alloc(2048));
  await touchOld(orphanKbDir);

  // 4. Create old file in a "real" KB dir (from KB store, not filesystem)
  const { listAllKbs } = await import("../src/lib/kb/store");
  const realKbs = listAllKbs();
  const realKbId = realKbs[0]?.id;
  let oldFilePath: string | null = null;
  if (realKbId) {
    const realKbDir = path.join(UPLOAD_DIR, realKbId);
    await fs.mkdir(realKbDir, { recursive: true }).catch(() => {});
    oldFilePath = path.join(realKbDir, "very-old-file.txt");
    await fs.writeFile(oldFilePath, Buffer.alloc(4096));
    await touchOld(oldFilePath);
  }

  console.log("[cleanup] Running cleanup...\n");

  // Run cleanup: active KBs from KB store, active uploads = {"active-upload-id"}
  const activeKbIds = new Set(realKbs.map((kb: any) => kb.id));
  const activeUploadIds = new Set(["active-upload-id"]);
  const stats = await runCleanup(activeKbIds, activeUploadIds);

  console.log(`  Stats: chunks=${stats.orphanedChunkDirs}, kbDirs=${stats.orphanedKbDirs}, oldFiles=${stats.oldFiles}, freed=${(stats.freedBytes / 1024).toFixed(0)}KB\n`);

  // Verify results
  console.log("[cleanup] Verifying...\n");
  check("orphaned chunk dir removed", !await fileExists(orphanChunkDir));
  check("active chunk dir preserved", await fileExists(activeChunkDir));
  check("orphaned KB dir removed", !await fileExists(orphanKbDir));
  check("existing KB dir preserved", !realKbId || await fileExists(path.join(UPLOAD_DIR, realKbId)));
  if (oldFilePath) {
    check("old file removed", !await fileExists(oldFilePath));
  }

  // Clean up active chunk dir (manual)
  await fs.rm(activeChunkDir, { recursive: true, force: true }).catch(() => {});

  console.log(`\n[cleanup] ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

main().catch((err) => {
  console.error("[cleanup] ❌ Error:", err);
  process.exit(1);
});
