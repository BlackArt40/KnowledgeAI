// ---------------------------------------------------------------------------
// ChromaVectorStore - self-hosted ChromaDB vector store adapter (v2 API).
//
// Requires:
//   1. ChromaDB running: docker run -p 8000:8000 chromadb/chroma
//   2. VECTOR_STORE=chromadb + CHROMA_URL in .env.local
//
// Uses ChromaDB REST v2 API directly via fetch (no npm dependency needed).
// Collections are named "kai_{kbId}" for per-KB isolation.
// ---------------------------------------------------------------------------

import type { VectorStore, SearchResult } from "./vector-store-interface";

// ── Configuration ────────────────────────────────────────────────────────

const TENANT = "default_tenant";
const DATABASE = "default_database";

function getBaseUrl(): string {
  return (process.env.CHROMA_URL || "http://localhost:8000").replace(/\/+$/, "");
}

function apiBase(): string {
  return `${getBaseUrl()}/api/v2/tenants/${TENANT}/databases/${DATABASE}`;
}

/** Collection name for a given KB. */
function colName(kbId: string): string {
  return `kai_${kbId}`;
}

// ── Internal helpers ─────────────────────────────────────────────────────

interface ChromaCollection {
  id: string;
  name: string;
  dimension: number | null;
  metadata: Record<string, unknown> | null;
}

/** Fetch wrapper with error handling. */
async function chromaFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${apiBase()}${path}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ChromaDB ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res;
}

/** Get or create a collection for the given KB. Returns collection ID. */
async function ensureCollection(kbId: string, dim?: number): Promise<string> {
  const existing = await _getColIdByName(kbId);
  if (existing) return existing;

  // Create new collection
  const name = colName(kbId);
  const body: Record<string, unknown> = { name };
  if (dim !== undefined) body.dimension = dim;
  const res = await chromaFetch("/collections", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const col: ChromaCollection = await res.json();
  return col.id;
}

/** Delete all chunks in a collection (v2 API does not support DELETE collection). */
async function deleteCollection(kbId: string): Promise<void> {
  const colId = await _getColIdByName(kbId);
  if (!colId) return;
  try {
    // Use a match-all where clause to delete every chunk
    await chromaFetch(`/collections/${colId}/delete`, {
      method: "POST",
      body: JSON.stringify({
        where: { doc_id: { "$ne": "___NONEXISTENT___" } },
      }),
    });
  } catch {
    // Ignore
  }
}

/** Internal: get collection ID by KB ID, or null if not found. */
async function _getColIdByName(kbId: string): Promise<string | null> {
  const name = colName(kbId);
  try {
    const res = await chromaFetch(`/collections?name=${encodeURIComponent(name)}`);
    const cols: ChromaCollection[] = await res.json();
    return cols.length > 0 ? cols[0].id : null;
  } catch {
    return null;
  }
}

/** Build metadata entries for a batch of chunks. */
function buildMetadatas(
  docId: string,
  docName: string,
  chunkCount: number
): Record<string, string | number>[] {
  const metas: Record<string, string | number>[] = [];
  for (let i = 0; i < chunkCount; i++) {
    metas.push({ doc_id: docId, doc_name: docName, chunk_index: i });
  }
  return metas;
}

// ── ChromaVectorStore ────────────────────────────────────────────────────

export class ChromaVectorStore implements VectorStore {
  async indexChunks(
    kbId: string,
    docId: string,
    docName: string,
    chunks: string[],
    vectors: Float32Array[]
  ): Promise<void> {
    const dim = vectors.length > 0 ? vectors[0].length : 1536;
    const colId = await ensureCollection(kbId, dim);

    // Remove existing chunks for this doc first (re-index safe)
    await this.clearDoc(kbId, docId);

    if (chunks.length === 0) return;

    const ids = chunks.map((_, i) => `${docId}_${i}`);
    const embeddings = vectors.map((v) => Array.from(v));
    const metadatas = buildMetadatas(docId, docName, chunks.length);

    await chromaFetch(`/collections/${colId}/add`, {
      method: "POST",
      body: JSON.stringify({
        ids,
        embeddings,
        metadatas,
        documents: chunks,
      }),
    });
  }

  async clearDoc(kbId: string, docId: string): Promise<void> {
    const colId = await _getColIdByName(kbId);
    if (!colId) return;

    await chromaFetch(`/collections/${colId}/delete`, {
      method: "POST",
      body: JSON.stringify({
        where: { doc_id: docId },
      }),
    }).catch(() => {
      // Ignore if no matching chunks
    });
  }

  async clearKb(kbId: string): Promise<void> {
    await deleteCollection(kbId);
  }

  async search(
    kbId: string,
    queryVec: Float32Array,
    topK: number
  ): Promise<SearchResult[]> {
    const colId = await _getColIdByName(kbId);
    if (!colId) return [];

    const queryEmbedding = Array.from(queryVec);

    const res = await chromaFetch(`/collections/${colId}/query`, {
      method: "POST",
      body: JSON.stringify({
        query_embeddings: [queryEmbedding],
        n_results: topK,
        include: ["metadatas", "documents", "distances"],
      }),
    });

    const data = await res.json();

    // ChromaDB returns arrays of arrays (one per query, we have 1 query)
    const distances: number[] = data.distances?.[0] ?? [];
    const documents: string[] = data.documents?.[0] ?? [];
    const metadatas: Record<string, unknown>[] = data.metadatas?.[0] ?? [];

    return metadatas.map((meta, i) => ({
      docId: (meta.doc_id as string) ?? "",
      docName: (meta.doc_name as string) ?? "",
      chunkIndex: (meta.chunk_index as number) ?? 0,
      text: documents[i] ?? "",
      // ChromaDB returns L2 distances by default; convert to similarity score
      // using 1 / (1 + distance) so higher = more similar
      score: 1 / (1 + (distances[i] ?? 999)),
    }));
  }

  async chunkCount(kbId: string): Promise<number> {
    const colId = await _getColIdByName(kbId);
    if (!colId) return 0;

    try {
      const res = await chromaFetch(`/collections/${colId}/count`);
      const count: number = await res.json();
      return count;
    } catch {
      return 0;
    }
  }

}
