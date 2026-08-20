// ---------------------------------------------------------------------------
// Storage - file upload abstraction (local filesystem or S3-compatible).
//
// When S3_ENDPOINT + S3_ACCESS_KEY + S3_SECRET_KEY are set -> upload to S3 /
// MinIO / Cloudflare R2 using @aws-sdk/client-s3.
// Otherwise -> save to local .uploads/ directory (demo mode).
//
// File type whitelist + size limits are enforced regardless of backend.
// ---------------------------------------------------------------------------

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getS3Config, uploadToS3, downloadFromS3, deleteFromS3, getPresignedUploadUrl } from "./s3";

export { getPresignedUploadUrl, getPresignedDownloadUrl } from "./s3";

export function isStorageEnabled(): boolean {
  return getS3Config() !== null;
}

export interface UploadResult {
  key: string;      // storage key / path
  url: string;      // accessible URL
  size: number;
}

// ── File validation ──────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".json",
  ".pdf", ".doc", ".docx", ".ppt", ".pptx",
  ".xls", ".xlsx",
  ".html", ".htm",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
  // P7-4: 视频字幕文件
  ".srt", ".vtt",
]);

const MAX_FILE_SIZE = parseInt(process.env.MAX_UPLOAD_MB || "50", 10) * 1024 * 1024;

export function validateFile(filename: string, size: number): { ok: boolean; error?: string } {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: `不支持的文件类型: ${ext}。允许: ${[...ALLOWED_EXTENSIONS].join(", ")}` };
  }
  if (size > MAX_FILE_SIZE) {
    return { ok: false, error: `文件过大: ${(size / 1024 / 1024).toFixed(1)}MB。上限: ${MAX_FILE_SIZE / 1024 / 1024}MB` };
  }
  return { ok: true };
}

// ── Core operations ──────────────────────────────────────────────────────

/** Save a file. Returns storage key + accessible URL. */
export async function saveFile(
  filename: string,
  data: Buffer | Uint8Array
): Promise<UploadResult> {
  const ext = path.extname(filename);
  const key = `${randomUUID()}${ext}`;

  if (isStorageEnabled()) {
    return uploadToS3(key, data);
  }

  // Local filesystem
  const uploadsDir = path.join(process.cwd(), ".uploads");
  await fs.mkdir(uploadsDir, { recursive: true });
  const filepath = path.join(uploadsDir, key);
  await fs.writeFile(filepath, data);
  // L-4: the returned URL `/api/files/<key>` is now a real fetchable endpoint
  // served by src/app/api/files/[key]/route.ts (added in the L-4 fix) - it
  // streams the locally-stored file back to authenticated callers. The
  // doc-process queue still reads the file directly from .uploads/<kbId>/<docId>-*
  // (no HTTP round-trip); readFile() remains the in-process path.
  return { key, url: `/api/files/${key}`, size: data.byteLength };
}

/** Read a file as a Buffer. */
export async function readFile(key: string): Promise<Buffer> {
  if (isStorageEnabled()) {
    return downloadFromS3(key);
  }
  const filepath = path.join(process.cwd(), ".uploads", key);
  return fs.readFile(filepath);
}

/** Delete a file. */
export async function deleteFile(key: string): Promise<void> {
  if (isStorageEnabled()) {
    await deleteFromS3(key);
    return;
  }
  const filepath = path.join(process.cwd(), ".uploads", key);
  await fs.unlink(filepath).catch(() => {});
}

/**
 * Create a presigned upload URL for direct browser-to-S3 upload.
 * Returns null in local mode (caller should use regular multipart upload).
 */
export async function createPresignedUpload(
  filename: string,
  expiresIn = 600
): Promise<{ url: string; key: string; method: "PUT" } | null> {
  if (!isStorageEnabled()) return null;
  return getPresignedUploadUrl(filename, expiresIn);
}
