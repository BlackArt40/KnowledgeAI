// P3 Phase 2a: authoritative Yjs state for collaborative document editing.
//
// The Next process owns the Y.Doc per document (same memory as the KB store),
// so no separate collaboration service or DB is needed in demo mode:
//   - GET returns the full Yjs update + state vector (client bootstrap)
//   - POST applies an update, broadcasts it on the KB SSE channel and debounces
//     a snapshot back into KbDocument.content (which triggers re-chunking)
//
// Persistence is the markdown snapshot, not raw Yjs updates: after a restart
// the Y.Doc is rebuilt from `content`, so only edits made while nobody is
// connected (already impossible - the last snapshot wins) could be lost.
import * as Y from "yjs";
import { publish } from "@/lib/realtime/bus";
import {
  getDocument,
  saveDocumentContent,
  resetDocForReindex,
  markDocFailed,
} from "@/lib/kb/store";
import { enqueue } from "@/lib/queue";
import { log } from "@/lib/obs/log";
import type { KbDocument } from "@/lib/kb/types";

/** Debounce window: keystrokes are coalesced before snapshotting/reindexing. */
const SNAPSHOT_MS = 2_000;
/** Drop idle Y.Docs so long-lived processes do not leak one doc per file. */
const IDLE_MS = 30 * 60_000;
/** A single Yjs update larger than this is rejected (16 MiB body cap is inside). */
const MAX_UPDATE_BYTES = 512 * 1024;

interface Entry {
  doc: Y.Doc;
  text: Y.Text;
  /** KbDocument.version this Y.Doc was built from (rebuild when it moves). */
  version: number;
  kbId: string;
  timer: ReturnType<typeof setTimeout> | null;
  lastUsed: number;
}

const g = globalThis as unknown as { __KAI_COLLAB_STATE__?: Map<string, Entry> };

function store(): Map<string, Entry> {
  if (!g.__KAI_COLLAB_STATE__) g.__KAI_COLLAB_STATE__ = new Map();
  return g.__KAI_COLLAB_STATE__;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromB64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function createEntry(doc: KbDocument): Entry {
  const ydoc = new Y.Doc();
  ydoc.getText("content").insert(0, doc.content ?? "");
  return {
    doc: ydoc,
    text: ydoc.getText("content"),
    version: doc.version ?? 1,
    kbId: doc.kbId,
    timer: null,
    lastUsed: Date.now(),
  };
}

function destroyEntry(docId: string, entry: Entry) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.doc.destroy();
  store().delete(docId);
}

function prune(now: number) {
  for (const [docId, entry] of store()) {
    if (!entry.timer && now - entry.lastUsed > IDLE_MS) destroyEntry(docId, entry);
  }
}

/** Get (or lazily create, rebuilding when the snapshot version moved on). */
function ensureEntry(doc: KbDocument): Entry {
  const docId = doc.id;
  const current = doc.version ?? 1;
  const existing = store().get(docId);
  if (existing && existing.version === current) {
    existing.lastUsed = Date.now();
    return existing;
  }
  if (existing) destroyEntry(docId, existing);
  const created = createEntry(doc);
  store().set(docId, created);
  return created;
}

/** Bootstrap payload for a client opening the document. */
export function getCollabState(
  docId: string
): { update: string; vector: string; version: number } | null {
  const doc = getDocument(docId);
  if (!doc) return null;
  prune(Date.now());
  const entry = ensureEntry(doc);
  return {
    update: b64(Y.encodeStateAsUpdate(entry.doc)),
    vector: b64(Y.encodeStateVector(entry.doc)),
    version: doc.version ?? 1,
  };
}

export type ApplyUpdateResult =
  | { ok: true; version: number }
  | { ok: false; reason: "not_found" | "too_large" | "invalid" };

/**
 * Apply a client update, broadcast it to other viewers and schedule a snapshot.
 * The update is NOT version-checked: Yjs updates are commutative and can arrive
 * out of order (that is the point of CRDT); only the snapshot uses OCC.
 */
export function applyCollabUpdate(
  docId: string,
  updateBase64: string,
  actor = "协同编辑"
): ApplyUpdateResult {
  const doc = getDocument(docId);
  if (!doc) return { ok: false, reason: "not_found" };
  let bytes: Uint8Array;
  try {
    bytes = fromB64(updateBase64);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (bytes.byteLength === 0) return { ok: false, reason: "invalid" };
  if (bytes.byteLength > MAX_UPDATE_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  const entry = ensureEntry(doc);
  try {
    Y.applyUpdate(entry.doc, bytes);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  entry.lastUsed = Date.now();

  // Clients apply this update locally; the snapshot (not the raw update) is
  // what other collaborators see if they reload from the KB list.
  publish(`kb:${entry.kbId}`, {
    type: "doc_yjs",
    kbId: entry.kbId,
    docId,
    update: updateBase64,
    actor,
  });

  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    flushCollabSnapshot(docId, actor);
  }, SNAPSHOT_MS);
  // Do not keep the process alive just for the debounce timer.
  entry.timer.unref?.();

  return { ok: true, version: doc.version ?? 1 };
}

/**
 * Collapse the Y.Doc text back into KbDocument.content and re-chunk.
 * `baseVersion` is the doc version the snapshot was built on; a concurrent
 * Phase-1 save wins the version race and the next update retries.
 * Exported for tests (timer-free deterministic snapshot).
 */
export function flushCollabSnapshot(
  docId: string,
  actor = "协同编辑"
): string | null {
  const entry = store().get(docId);
  const doc = getDocument(docId);
  if (!entry || !doc) return null;
  const text = entry.text.toString();
  if (text === (doc.content ?? "")) return null;

  const saved = saveDocumentContent(docId, text, actor, doc.version ?? 1);
  if (!saved.ok) return null;
  entry.version = saved.doc.version ?? entry.version + 1;

  try {
    resetDocForReindex(docId);
    void enqueue("doc-process", { docId }).catch((err) => {
      markDocFailed(docId, err instanceof Error ? err.message : "入队失败");
    });
  } catch (err) {
    markDocFailed(docId, err instanceof Error ? err.message : "入队失败");
    log.warn({ err, docId }, "[collab] Failed to enqueue reindex after snapshot");
  }
  return text;
}

/** Test/teardown helper: drop cached Yjs state for one document. */
export function destroyCollabState(docId: string): void {
  const entry = store().get(docId);
  if (entry) destroyEntry(docId, entry);
}
