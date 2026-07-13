// ---------------------------------------------------------------------------
// Upload Session Store - tracks chunked/resumable upload sessions.
//
// Each session tracks:
//   - file metadata (name, size, type)
//   - chunking config (chunkSize, totalChunks)
//   - received chunks (for resume / progress)
//   - S3 multipart upload ID (when S3 is configured)
//   - local temp directory (when local storage)
//
// Sessions auto-expire after 2 hours of inactivity.
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";

export interface UploadSession {
  uploadId: string;
  kbId: string;
  userId: string;
  filename: string;
  fileSize: number;
  fileType: string;
  chunkSize: number;
  totalChunks: number;
  /** Set of received chunk indices (0-based). */
  receivedChunks: Set<number>;
  /** S3 multipart upload ID (null in local mode). */
  s3UploadId: string | null;
  /** S3 object key for the final file. */
  s3Key: string | null;
  /** ETags from S3 UploadPart responses, keyed by part number (1-based). */
  partETags: Map<number, string>;
  /** Local temp directory for chunks (null in S3 mode). */
  tempDir: string | null;
  createdAt: number;
  updatedAt: number;
}

type Store = Map<string, UploadSession>;

const g = globalThis as unknown as { __KAI_UPLOAD_STORE__?: Store };

function store(): Store {
  if (!g.__KAI_UPLOAD_STORE__) g.__KAI_UPLOAD_STORE__ = new Map();
  return g.__KAI_UPLOAD_STORE__;
}

const SESSION_TTL = 2 * 60 * 60 * 1000; // 2 hours

/** Purge expired sessions. */
function purgeExpired(): void {
  const now = Date.now();
  for (const [id, s] of store()) {
    if (now - s.updatedAt > SESSION_TTL) store().delete(id);
  }
}

/** Create a new upload session. */
export function createSession(input: {
  kbId: string;
  userId: string;
  filename: string;
  fileSize: number;
  fileType: string;
  chunkSize: number;
  totalChunks: number;
  s3UploadId?: string | null;
  s3Key?: string | null;
  tempDir?: string | null;
}): UploadSession {
  purgeExpired();
  const now = Date.now();
  const session: UploadSession = {
    uploadId: randomUUID(),
    kbId: input.kbId,
    userId: input.userId,
    filename: input.filename,
    fileSize: input.fileSize,
    fileType: input.fileType,
    chunkSize: input.chunkSize,
    totalChunks: input.totalChunks,
    receivedChunks: new Set(),
    s3UploadId: input.s3UploadId ?? null,
    s3Key: input.s3Key ?? null,
    partETags: new Map(),
    tempDir: input.tempDir ?? null,
    createdAt: now,
    updatedAt: now,
  };
  store().set(session.uploadId, session);
  return session;
}

/** Get a session by ID. */
export function getSession(uploadId: string): UploadSession | null {
  purgeExpired();
  return store().get(uploadId) ?? null;
}

/** Mark a chunk as received and store its S3 ETag (if applicable). */
export function markChunkReceived(
  uploadId: string,
  chunkIndex: number,
  etag?: string
): UploadSession | null {
  const s = store().get(uploadId);
  if (!s) return null;
  s.receivedChunks.add(chunkIndex);
  if (etag) s.partETags.set(chunkIndex + 1, etag); // S3 parts are 1-based
  s.updatedAt = Date.now();
  return s;
}

/** Remove a session. */
export function deleteSession(uploadId: string): void {
  store().delete(uploadId);
}

/** Get the set of all active upload IDs (for cleanup orphan detection). */
export function getActiveUploadIds(): Set<string> {
  purgeExpired();
  return new Set(store().keys());
}

/** Default chunk size in bytes (5 MB - S3 minimum part size). */
export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

/** Get configured chunk size from env. */
export function getChunkSize(): number {
  const mb = parseInt(process.env.CHUNK_SIZE_MB || "5", 10);
  return Math.max(1, mb) * 1024 * 1024;
}
