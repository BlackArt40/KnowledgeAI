// Batch 2 (P1): chunked-upload sessions. The session store is what makes
// resumable uploads resumable — chunk bookkeeping and the byte cross-check
// (F7: never trust the client-declared size) live here.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHUNK_SIZE,
  createSession,
  deleteSession,
  getActiveUploadIds,
  getChunkSize,
  getSession,
  markChunkReceived,
} from "./store";

const g = globalThis as unknown as { __KAI_UPLOAD_STORE__?: Map<string, unknown> };

function newSession(over: Partial<Parameters<typeof createSession>[0]> = {}) {
  return createSession({
    kbId: "kb_1",
    userId: "usr_1",
    filename: "a.pdf",
    fileSize: 10_000,
    fileType: "application/pdf",
    chunkSize: 1_000,
    totalChunks: 10,
    ...over,
  });
}

beforeEach(() => {
  delete g.__KAI_UPLOAD_STORE__;
  delete process.env.CHUNK_SIZE_MB;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CHUNK_SIZE_MB;
});

describe("createSession / getSession", () => {
  it("starts with an empty chunk set and no storage handles", () => {
    const s = newSession();

    expect(s.uploadId).toMatch(/[0-9a-f-]{36}/);
    expect(s.receivedChunks.size).toBe(0);
    expect(s.receivedBytes).toBe(0);
    expect(s.partETags.size).toBe(0);
    expect(s.s3UploadId).toBeNull();
    expect(s.tempDir).toBeNull();
    expect(s.createdAt).toBe(s.updatedAt);
  });

  it("keeps the S3 handles when supplied (multipart mode)", () => {
    const s = newSession({ s3UploadId: "mpu_1", s3Key: "kb/doc", tempDir: null });
    expect(s.s3UploadId).toBe("mpu_1");
    expect(s.s3Key).toBe("kb/doc");
  });

  it("returns null for an unknown session id", () => {
    expect(getSession("nope")).toBeNull();
  });
});

describe("markChunkReceived", () => {
  it("returns null when the session is gone", () => {
    expect(markChunkReceived("missing", 0)).toBeNull();
  });

  it("records the chunk, accumulates bytes and stores a 1-based ETag", () => {
    const s = newSession();

    const updated = markChunkReceived(s.uploadId, 0, { etag: "etag-0", bytes: 1_000 })!;

    expect(updated.receivedChunks.has(0)).toBe(true);
    expect(updated.receivedBytes).toBe(1_000);
    expect(updated.partETags.get(1)).toBe("etag-0"); // S3 parts are 1-based
  });

  it("ignores zero bytes and is idempotent for repeated chunk indices", () => {
    const s = newSession();
    markChunkReceived(s.uploadId, 3, { bytes: 500 });
    const again = markChunkReceived(s.uploadId, 3, { bytes: 0 })!;

    expect(again.receivedChunks.size).toBe(1);
    expect(again.receivedBytes).toBe(500);
  });

  it("refreshes updatedAt so a resumed upload does not expire mid-flight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
    const s = newSession();
    vi.setSystemTime(new Date("2026-03-01T01:00:00Z"));

    const updated = markChunkReceived(s.uploadId, 1)!;
    expect(updated.updatedAt).toBe(new Date("2026-03-01T01:00:00Z").getTime());
  });
});

describe("session lifecycle", () => {
  it("lists active ids and drops deleted sessions", () => {
    const a = newSession();
    const b = newSession({ filename: "b.pdf" });

    expect(getActiveUploadIds()).toEqual(new Set([a.uploadId, b.uploadId]));
    deleteSession(a.uploadId);
    expect(getActiveUploadIds()).toEqual(new Set([b.uploadId]));
    expect(getSession(a.uploadId)).toBeNull();
  });

  it("purges sessions idle for more than two hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
    const stale = newSession();
    const fresh = newSession({ filename: "fresh.pdf" });

    // Touch only the fresh one, then jump past the TTL.
    vi.setSystemTime(new Date("2026-03-01T01:00:00Z"));
    markChunkReceived(fresh.uploadId, 0);
    // 2.5h idle for the untouched session, 1.5h for the touched one.
    vi.setSystemTime(new Date("2026-03-01T02:30:00Z"));

    expect(getActiveUploadIds()).toEqual(new Set([fresh.uploadId]));
    expect(getSession(stale.uploadId)).toBeNull();
  });
});

describe("getChunkSize", () => {
  it("defaults to the S3 minimum part size", () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(5 * 1024 * 1024);
    expect(getChunkSize()).toBe(DEFAULT_CHUNK_SIZE);
  });

  it("honours CHUNK_SIZE_MB and never goes below 1 MB", () => {
    process.env.CHUNK_SIZE_MB = "8";
    expect(getChunkSize()).toBe(8 * 1024 * 1024);

    process.env.CHUNK_SIZE_MB = "0";
    expect(getChunkSize()).toBe(1024 * 1024);
  });

  // KNOWN GAP (batch 2): parseInt("garbage") -> NaN, Math.max(1, NaN) -> NaN,
  // so a typo'd CHUNK_SIZE_MB yields NaN bytes instead of the 5 MB default.
  // `fails` keeps it visible; the fix flips this to a normal assertion.
  it.fails("falls back to the default for an unparseable CHUNK_SIZE_MB", () => {
    process.env.CHUNK_SIZE_MB = "not-a-number";
    expect(getChunkSize()).toBe(DEFAULT_CHUNK_SIZE);
  });
});
