// ---------------------------------------------------------------------------
// ZIP archive writer - thin wrapper over `fflate` (mature, synchronous, ~8 KB).
//
// 2026-11-27: replaced the hand-rolled CRC32 + local/central-header builder
// (110 lines) with fflate's zipSync. The archive is only the transport for the
// PPTX package, so it just has to be a standards-compliant ZIP: fflate writes
// deflate entries, a correct central directory/EOCD, and sets the UTF-8 name
// flag for non-ASCII names (the old writer emitted UTF-8 bytes with flags=0,
// which some readers misinterpret).
//
// The mtime is pinned: fflate otherwise stamps "now" into every header, which
// would make two exports of the same report differ byte-for-byte (pptx.test.ts
// asserts determinism).
// ---------------------------------------------------------------------------

import { zipSync } from "fflate";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Fixed date built from LOCAL components so the DOS date bytes are identical
 *  on every machine/timezone. */
const FIXED_MTIME = new Date(1980, 0, 1, 0, 0, 0);

/**
 * Build a ZIP archive from the given entries. Each entry is deflate-compressed.
 * Returns the raw archive bytes. Duplicate names keep the last entry.
 */
export function zipFiles(entries: ZipEntry[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) files[entry.name] = entry.data;
  return zipSync(files, { level: 6, mtime: FIXED_MTIME });
}
