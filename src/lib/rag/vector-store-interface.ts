// ---------------------------------------------------------------------------
// VectorStore Interface - abstraction over vector storage backends.
//
// Implementations:
//   - MemoryVectorStore  (default, in-memory Map + cosine similarity)
//   - PgVectorStore      (PostgreSQL + pgvector extension, HNSW/IVFFlat index)
//   - ChromaVectorStore  (future - self-hosted ChromaDB)
//   - PineconeVectorStore (managed Pinecone, VECTOR_STORE=pinecone)
//
// Selected via VECTOR_STORE env var: "memory" (default) | "pgvector"
// ---------------------------------------------------------------------------

export interface VectorChunk {
  docId: string;
  docName: string;
  chunkIndex: number;
  text: string;
  vector: Float32Array;
}

export interface SearchResult {
  docId: string;
  docName: string;
  chunkIndex: number;
  text: string;
  score: number;
}

export interface VectorStore {
  /** Index (or re-index) document chunks into a KB's vector space. */
  indexChunks(
    kbId: string,
    docId: string,
    docName: string,
    chunks: string[],
    vectors: Float32Array[]
  ): Promise<void>;

  /** Remove all chunks for a specific document. */
  clearDoc(kbId: string, docId: string): Promise<void>;

  /** Remove all chunks for an entire KB. */
  clearKb(kbId: string): Promise<void>;

  /** Search for top-K similar chunks given a query vector. */
  search(kbId: string, queryVec: Float32Array, topK: number): Promise<SearchResult[]>;

  /** Count chunks in a KB (optional, for stats). */
  chunkCount(kbId: string): Promise<number>;
}
