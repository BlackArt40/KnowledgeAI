import { embed, cosine } from "./embeddings";
import { embedText } from "@/lib/llm/provider";

// In-memory per-KB vector index (persisted on globalThis for dev HMR).
// 🔌 Integration point: replace with ChromaDB / pgvector / Pinecone.
// Vectors can be any dimension — local hash (2048) or OpenAI (1536/3072).

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

/**
 * Index document chunks into the per-KB vector store.
 * Uses LLM embeddings (OpenAI) if configured, else local hash embeddings.
 */
export async function indexChunks(
  kbId: string,
  docId: string,
  docName: string,
  chunks: string[]
) {
  const s = store();
  const list = s.get(kbId) ?? [];
  // remove existing chunks for this doc (re-index safe)
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].docId === docId) list.splice(i, 1);
  }
  // Batch embed for efficiency (OpenAI supports batch input)
  const vectors = await embedBatchSafe(chunks);
  chunks.forEach((text, idx) => {
    list.push({ docId, docName, chunkIndex: idx, text, vector: vectors[idx] });
  });
  s.set(kbId, list);
}

async function embedBatchSafe(texts: string[]): Promise<Float32Array[]> {
  try {
    const { embedBatch } = await import("@/lib/llm/provider");
    return await embedBatch(texts);
  } catch {
    return texts.map((t) => embed(t));
  }
}

export function clearDoc(kbId: string, docId: string) {
  const s = store();
  const list = s.get(kbId);
  if (!list) return;
  s.set(
    kbId,
    list.filter((c) => c.docId !== docId)
  );
}

export function clearKb(kbId: string) {
  store().delete(kbId);
}

export function search(
  kbId: string,
  queryVec: Float32Array,
  topK: number
): { docId: string; docName: string; chunkIndex: number; text: string; score: number }[] {
  const list = store().get(kbId) ?? [];
  return list
    .map((c) => ({ docId: c.docId, docName: c.docName, chunkIndex: c.chunkIndex, text: c.text, score: cosine(queryVec, c.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function chunkCount(kbId: string): number {
  return store().get(kbId)?.length ?? 0;
}
