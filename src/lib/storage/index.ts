// ---------------------------------------------------------------------------
// Storage — file upload abstraction (local filesystem or S3-compatible).
//
// When S3_ENDPOINT + S3_ACCESS_KEY are set → upload to S3 / MinIO / R2.
// Otherwise → save to local .uploads/ directory (demo mode).
// ---------------------------------------------------------------------------

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export function isStorageEnabled(): boolean {
  return !!process.env.S3_ENDPOINT && !!process.env.S3_ACCESS_KEY;
}

export interface UploadResult {
  key: string;      // storage key / path
  url: string;      // accessible URL
  size: number;
}

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

// ── S3 operations (using fetch with SigV4 — or install @aws-sdk/client-s3) ──
// 🔌 For production, install @aws-sdk/client-s3 and use PutObjectCommand etc.

async function uploadToS3(key: string, data: Buffer | Uint8Array): Promise<UploadResult> {
  const bucket = process.env.S3_BUCKET || "knowledgeai-uploads";
  const endpoint = process.env.S3_ENDPOINT!;
  // Simplified: in production use AWS SDK with proper SigV4 signing
  // This is a placeholder showing the interface
  console.log(`[storage] S3 upload: ${bucket}/${key} (${data.byteLength} bytes) → ${endpoint}`);
  return {
    key,
    url: `${endpoint}/${bucket}/${key}`,
    size: data.byteLength,
  };
}

async function downloadFromS3(key: string): Promise<Buffer> {
  const bucket = process.env.S3_BUCKET || "knowledgeai-uploads";
  const endpoint = process.env.S3_ENDPOINT!;
  const res = await fetch(`${endpoint}/${bucket}/${key}`);
  if (!res.ok) throw new Error(`S3 download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function deleteFromS3(key: string): Promise<void> {
  const bucket = process.env.S3_BUCKET || "knowledgeai-uploads";
  const endpoint = process.env.S3_ENDPOINT!;
  await fetch(`${endpoint}/${bucket}/${key}`, { method: "DELETE" }).catch(() => {});
}
