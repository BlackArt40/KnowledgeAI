// ---------------------------------------------------------------------------
// Vector Store - factory + public API.
//
// Selects the active VectorStore implementation based on VECTOR_STORE env var:
//   "memory"   (default) -> MemoryVectorStore  (in-memory, demo mode)
//   "pgvector"           -> PgVectorStore      (PostgreSQL + pgvector)
//
// All operations are async to support both sync (memory) and async (DB) backends.
// ---------------------------------------------------------------------------

import { embed } from "./embeddings";
import { MemoryVectorStore } from "./vector-store-memory";
import { PgVectorStore } from "./vector-store-pgvector";
import { ChromaVectorStore } from "./vector-store-chromadb";
import { clearBM25Doc, clearBM25Kb } from "./bm25";
import type { VectorStore } from "./vector-store-interface";

let _instance: VectorStore | null = null;

function getStore(): VectorStore {
  if (_instance) return _instance;
  const backend = process.env.VECTOR_STORE || "memory";
  switch (backend) {
    case "pgvector":
      _instance = new PgVectorStore();
      break;
    case "chromadb":
      _instance = new ChromaVectorStore();
      break;
    case "memory":
    default:
      _instance = new MemoryVectorStore();
      break;
  }
  if (backend !== "memory") {
    console.log(`[rag] Vector store: ${backend}`);
  }
  return _instance;
}

// ── Embedding helper (used by indexChunks callers) ───────────────────────

async function embedBatchSafe(texts: string[]): Promise<Float32Array[]> {
  try {
    const { embedBatch } = await import("@/lib/llm/provider");
    return await embedBatch(texts);
  } catch {
    return texts.map((t) => embed(t));
  }
}

// ── Public API (async, delegates to active implementation) ───────────────

/**
 * Index document chunks into the per-KB vector store.
 * Embeds the chunks (LLM if configured, else local hash) and stores them.
 */
export async function indexChunks(
  kbId: string,
  docId: string,
  docName: string,
  chunks: string[]
) {
  const vectors = await embedBatchSafe(chunks);
  await getStore().indexChunks(kbId, docId, docName, chunks, vectors);
}

/** Remove all chunks for a specific document (vector + BM25). */
export async function clearDoc(kbId: string, docId: string): Promise<void> {
  await getStore().clearDoc(kbId, docId);
  clearBM25Doc(kbId, docId);
}

/** Remove all chunks for an entire KB (vector + BM25). */
export async function clearKb(kbId: string): Promise<void> {
  await getStore().clearKb(kbId);
  clearBM25Kb(kbId);
}

/** Search for top-K similar chunks given a query vector. */
export async function search(
  kbId: string,
  queryVec: Float32Array,
  topK: number
) {
  return getStore().search(kbId, queryVec, topK);
}

/** Count chunks in a KB. */
export async function chunkCount(kbId: string): Promise<number> {
  return getStore().chunkCount(kbId);
}
