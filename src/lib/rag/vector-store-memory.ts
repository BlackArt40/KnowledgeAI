// ---------------------------------------------------------------------------
// MemoryVectorStore - in-memory vector index (default / demo mode).
//
// Per-KB vector index persisted on globalThis for dev HMR survival.
// Uses brute-force cosine similarity - fine for small datasets (< 50k chunks).
// ---------------------------------------------------------------------------

import { cosine } from "./embeddings";
import type { VectorStore, SearchResult } from "./vector-store-interface";

interface StoredChunk {
  docId: string;
  docName: string;
  chunkIndex: number;
  text: string;
  vector: Float32Array;
}

const g = globalThis as unknown as { __KAI_VS__?: Map<string, StoredChunk[]> };
function store(): Map<string, StoredChunk[]> {
  if (!g.__KAI_VS__) g.__KAI_VS__ = new Map();
  return g.__KAI_VS__;
}

export class MemoryVectorStore implements VectorStore {
  async indexChunks(
    kbId: string,
    docId: string,
    docName: string,
    chunks: string[],
    vectors: Float32Array[]
  ): Promise<void> {
    const s = store();
    const list = s.get(kbId) ?? [];
    // Remove existing chunks for this doc (re-index safe)
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].docId === docId) list.splice(i, 1);
    }
    chunks.forEach((text, idx) => {
      list.push({ docId, docName, chunkIndex: idx, text, vector: vectors[idx] });
    });
    s.set(kbId, list);
  }

  async clearDoc(kbId: string, docId: string): Promise<void> {
    const s = store();
    const list = s.get(kbId);
    if (!list) return;
    s.set(
      kbId,
      list.filter((c) => c.docId !== docId)
    );
  }

  async clearKb(kbId: string): Promise<void> {
    store().delete(kbId);
  }

  async search(
    kbId: string,
    queryVec: Float32Array,
    topK: number
  ): Promise<SearchResult[]> {
    const list = store().get(kbId) ?? [];
    return list
      .map((c) => ({
        docId: c.docId,
        docName: c.docName,
        chunkIndex: c.chunkIndex,
        text: c.text,
        score: cosine(queryVec, c.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async chunkCount(kbId: string): Promise<number> {
    return store().get(kbId)?.length ?? 0;
  }
}
