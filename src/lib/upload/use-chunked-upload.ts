// ---------------------------------------------------------------------------
// useChunkedUpload - React hook for resumable chunked file upload.
//
// Features:
//   - Splits large files into chunks (default 5MB)
//   - Concurrent chunk upload (default 3 parallel)
//   - Resume after interruption (checks which chunks are already received)
//   - Per-chunk retry on failure (default 3 attempts)
//   - Progress tracking (percentage + received/total chunks)
//   - Abort support
// ---------------------------------------------------------------------------

import * as React from "react";

export interface ChunkedUploadState {
  status: "idle" | "uploading" | "completing" | "done" | "error" | "aborted";
  progress: number; // 0-100
  receivedChunks: number;
  totalChunks: number;
  error: string | null;
}

const INITIAL_STATE: ChunkedUploadState = {
  status: "idle",
  progress: 0,
  receivedChunks: 0,
  totalChunks: 0,
  error: null,
};

const CONCURRENCY = 3;
const MAX_RETRY = 3;
/** Files larger than this use chunked upload (smaller files use direct upload). */
export const CHUNKED_THRESHOLD = 5 * 1024 * 1024; // 5 MB

export function useChunkedUpload() {
  const [state, setState] = React.useState<ChunkedUploadState>(INITIAL_STATE);
  const abortRef = React.useRef(false);

  const update = React.useCallback((patch: Partial<ChunkedUploadState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  /** Upload a single chunk with retry. */
  const uploadChunk = React.useCallback(
    async (
      uploadId: string,
      file: File,
      index: number,
      chunkSize: number
    ): Promise<boolean> => {
      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const blob = file.slice(start, end);

      for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
        if (abortRef.current) return false;
        try {
          const form = new FormData();
          form.append("chunk", blob);
          form.append("index", String(index));
          const res = await fetch(`/api/upload/chunk/${uploadId}`, {
            method: "POST",
            body: form,
          });
          if (res.ok) return true;
          if (res.status === 404) throw new Error("上传会话已过期");
          const m = await res.json().catch(() => ({}));
          throw new Error(m.error ?? `分片 ${index + 1} 上传失败`);
        } catch (e) {
          if (abortRef.current) return false;
          if (attempt === MAX_RETRY - 1) throw e;
          // Exponential backoff before retry
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
      return false;
    },
    []
  );

  /** Upload a file using chunked upload with resume support. */
  const upload = React.useCallback(
    async (file: File, kbId: string): Promise<{ docId?: string } | null> => {
      abortRef.current = false;
      setState({ ...INITIAL_STATE, status: "uploading", totalChunks: 0 });

      try {
        // 1. Initialize session
        const initRes = await fetch("/api/upload/chunk/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kbId, filename: file.name, fileSize: file.size }),
        });
        if (!initRes.ok) {
          const m = await initRes.json().catch(() => ({}));
          throw new Error(m.error ?? "初始化上传失败");
        }
        const { uploadId, chunkSize, totalChunks } = await initRes.json();
        update({ totalChunks });

        // 2. Check status for resume (which chunks already received?)
        let receivedSet = new Set<number>();
        try {
          const statusRes = await fetch(`/api/upload/chunk/${uploadId}/status`);
          if (statusRes.ok) {
            const status = await statusRes.json();
            receivedSet = new Set(status.receivedChunks ?? []);
            update({ receivedChunks: receivedSet.size });
          }
        } catch {
          // Fresh upload, no resume needed
        }

        // 3. Build list of chunks to upload (skip already-received)
        const pending: number[] = [];
        for (let i = 0; i < totalChunks; i++) {
          if (!receivedSet.has(i)) pending.push(i);
        }

        // 4. Upload chunks with concurrency
        let completed = receivedSet.size;
        const queue = [...pending];

        async function worker() {
          while (queue.length > 0 && !abortRef.current) {
            const index = queue.shift()!;
            await uploadChunk(uploadId, file, index, chunkSize);
            completed++;
            update({
              receivedChunks: completed,
              progress: Math.round((completed / totalChunks) * 100),
            });
          }
        }

        await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

        if (abortRef.current) {
          update({ status: "aborted" });
          return null;
        }

        // 5. Complete the upload
        update({ status: "completing", progress: 100 });
        const completeRes = await fetch(`/api/upload/chunk/${uploadId}/complete`, {
          method: "POST",
        });
        if (!completeRes.ok) {
          const m = await completeRes.json().catch(() => ({}));
          throw new Error(m.error ?? "合并上传失败");
        }
        const { doc } = await completeRes.json();
        update({ status: "done" });
        return { docId: doc?.id };
      } catch (e) {
        update({
          status: "error",
          error: e instanceof Error ? e.message : "上传失败",
        });
        return null;
      }
    },
    [update, uploadChunk]
  );

  /** Abort the current upload. */
  const abort = React.useCallback(async (uploadId?: string) => {
    abortRef.current = true;
    if (uploadId) {
      try {
        await fetch(`/api/upload/chunk/${uploadId}`, { method: "DELETE" });
      } catch {
        // Best-effort
      }
    }
    update({ status: "aborted" });
  }, [update]);

  /** Reset to idle state. */
  const reset = React.useCallback(() => {
    abortRef.current = false;
    setState(INITIAL_STATE);
  }, []);

  return { state, upload, abort, reset };
}
