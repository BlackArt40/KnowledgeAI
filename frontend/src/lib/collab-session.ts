// P3 Phase 2c: client-side Yjs session.
//
// Bootstrap: GET full update → Y.applyUpdate. Local edits are coalesced for
// 120ms and POSTed as one incremental update; remote updates arrive through the
// KB SSE `doc_yjs` frame and are applied with origin "remote" so they are not
// echoed back. The server snapshots to markdown on its own 2s debounce.
import * as Y from "yjs";
import { fetchCollabState, postCollabUpdate } from "@/api/kb";

export type CollabStatus = "syncing" | "synced" | "error";

export interface CollabSession {
  doc: Y.Doc;
  text: Y.Text;
  applyRemote(updateBase64: string): void;
  onStatus(cb: (status: CollabStatus) => void): () => void;
  onText(cb: (value: string) => void): () => void;
  destroy(): void;
}

const PUSH_DEBOUNCE_MS = 120;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function createCollabSession(
  kbId: string,
  docId: string
): Promise<CollabSession> {
  const boot = await fetchCollabState(kbId, docId);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(boot.update), "bootstrap");
  const text = doc.getText("content");

  const statusListeners = new Set<(status: CollabStatus) => void>();
  const textListeners = new Set<(value: string) => void>();
  const emitStatus = (status: CollabStatus) => statusListeners.forEach((cb) => cb(status));
  const emitText = (value: string) => textListeners.forEach((cb) => cb(value));

  let pending: Uint8Array | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sending = false;
  let destroyed = false;

  const schedule = () => {
    if (destroyed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, PUSH_DEBOUNCE_MS);
  };

  const flush = async (): Promise<void> => {
    if (destroyed || !pending) return;
    if (sending) {
      schedule();
      return;
    }
    const update = pending;
    pending = null;
    sending = true;
    emitStatus("syncing");
    try {
      await postCollabUpdate(kbId, docId, toBase64(update));
      emitStatus(pending ? "syncing" : "synced");
    } catch {
      // Keep the bytes and retry after the next debounce window.
      pending = pending ? Y.mergeUpdates([update, pending]) : update;
      emitStatus("error");
      schedule();
    } finally {
      sending = false;
      if (pending) schedule();
    }
  };

  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote" || origin === "bootstrap" || destroyed) return;
    pending = pending ? Y.mergeUpdates([pending, update]) : update;
    schedule();
  };
  doc.on("update", onUpdate);

  const textObserver = () => emitText(text.toString());
  text.observe(textObserver);

  return {
    doc,
    text,
    applyRemote(updateBase64: string) {
      if (destroyed) return;
      try {
        Y.applyUpdate(doc, fromBase64(updateBase64), "remote");
      } catch {
        // Malformed frame: ignore rather than killing the session.
      }
    },
    onStatus(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    onText(cb) {
      textListeners.add(cb);
      cb(text.toString());
      return () => textListeners.delete(cb);
    },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      doc.off("update", onUpdate);
      text.unobserve(textObserver);
      doc.destroy();
      statusListeners.clear();
      textListeners.clear();
    },
  };
}
