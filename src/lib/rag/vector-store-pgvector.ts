// ---------------------------------------------------------------------------
// PgVectorStore - PostgreSQL + pgvector extension for production vector search.
//
// Requires:
//   1. PostgreSQL with pgvector extension: CREATE EXTENSION vector;
//   2. VECTOR_STORE=pgvector + DATABASE_URL in .env.local
//   3. @prisma/client installed
//
// Uses Prisma raw queries for vector operations ($queryRaw / $executeRaw).
// HNSW index on the embedding column for ANN search.
//
// Table schema (auto-created on first use):
//   CREATE TABLE IF NOT EXISTS kb_chunks (
//     id          TEXT PRIMARY KEY,
//     kb_id       TEXT NOT NULL,
//     doc_id      TEXT NOT NULL,
//     doc_name    TEXT NOT NULL,
//     chunk_index INT NOT NULL,
//     text        TEXT NOT NULL,
//     embedding   vector(<dim>),
//   );
//   CREATE INDEX ON kb_chunks USING hnsw (embedding vector_cosine_ops);
// ---------------------------------------------------------------------------

import { getDb, isDbEnabled } from "@/lib/db/client";
import type { VectorStore, SearchResult } from "./vector-store-interface";

// Prisma client shape for raw queries (avoids importing @prisma/client types)
interface PrismaClient {
  $queryRaw<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]>;
  $executeRaw(sql: string, ...params: unknown[]): Promise<number>;
}

let initialized = false;
let vectorDim = 0;

/** Detect vector dimension from the first embedding we see. */
function detectDim(vectors: Float32Array[]): number {
  if (vectors.length > 0 && vectors[0].length > 0) return vectors[0].length;
  return 1536; // default OpenAI embedding dim
}

/** Convert Float32Array to pgvector string format: "[0.1,0.2,...]" */
function toPgVector(v: Float32Array): string {
  return `[${Array.from(v).join(",")}]`;
}

/** Ensure the kb_chunks table + indexes exist. */
async function ensureSchema(dim: number): Promise<void> {
  if (initialized && dim === vectorDim) return;
  const db = (await getDb()) as PrismaClient | null;
  if (!db) return;

  await db.$executeRaw(`
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      kb_id       TEXT NOT NULL,
      doc_id      TEXT NOT NULL,
      doc_name    TEXT NOT NULL,
      chunk_index INT NOT NULL,
      text        TEXT NOT NULL,
      embedding   vector(${dim})
    )
  `);
  await db.$executeRaw(
    `CREATE INDEX IF NOT EXISTS idx_kb_chunks_kb ON kb_chunks (kb_id)`
  );
  await db.$executeRaw(
    `CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks (doc_id)`
  );
  // HNSW index for ANN cosine search (created once, offline-friendly)
  await db.$executeRaw(
    `CREATE INDEX IF NOT EXISTS idx_kb_chunks_emb ON kb_chunks USING hnsw (embedding vector_cosine_ops)`
  );
  vectorDim = dim;
  initialized = true;
}

interface PgChunkRow {
  id: string;
  doc_id: string;
  doc_name: string;
  chunk_index: number;
  text: string;
  similarity: number;
}

export class PgVectorStore implements VectorStore {
  async indexChunks(
    kbId: string,
    docId: string,
    docName: string,
    chunks: string[],
    vectors: Float32Array[]
  ): Promise<void> {
    if (!isDbEnabled()) return;
    const db = (await getDb()) as PrismaClient | null;
    if (!db) return;

    const dim = detectDim(vectors);
    await ensureSchema(dim);

    // Remove existing chunks for this doc (re-index safe)
    await db.$executeRaw(
      `DELETE FROM kb_chunks WHERE kb_id = $1 AND doc_id = $2`,
      kbId,
      docId
    );

    // Batch insert
    for (let i = 0; i < chunks.length; i++) {
      await db.$executeRaw(
        `INSERT INTO kb_chunks (kb_id, doc_id, doc_name, chunk_index, text, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)`,
        kbId,
        docId,
        docName,
        i,
        chunks[i],
        toPgVector(vectors[i])
      );
    }
  }

  async clearDoc(kbId: string, docId: string): Promise<void> {
    if (!isDbEnabled()) return;
    const db = (await getDb()) as PrismaClient | null;
    if (!db) return;
    await db.$executeRaw(
      `DELETE FROM kb_chunks WHERE kb_id = $1 AND doc_id = $2`,
      kbId,
      docId
    );
  }

  async clearKb(kbId: string): Promise<void> {
    if (!isDbEnabled()) return;
    const db = (await getDb()) as PrismaClient | null;
    if (!db) return;
    await db.$executeRaw(`DELETE FROM kb_chunks WHERE kb_id = $1`, kbId);
  }

  async search(
    kbId: string,
    queryVec: Float32Array,
    topK: number
  ): Promise<SearchResult[]> {
    if (!isDbEnabled()) return [];
    const db = (await getDb()) as PrismaClient | null;
    if (!db) return [];

    const dim = queryVec.length;
    await ensureSchema(dim);

    // Cosine distance via pgvector <=> operator (1 - cosine_similarity)
    const rows = await db.$queryRaw<PgChunkRow>(
      `SELECT doc_id, doc_name, chunk_index, text,
              1 - (embedding <=> $2::vector) AS similarity
       FROM kb_chunks
       WHERE kb_id = $1
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      kbId,
      toPgVector(queryVec),
      topK
    );

    return rows.map((r) => ({
      docId: r.doc_id,
      docName: r.doc_name,
      chunkIndex: r.chunk_index,
      text: r.text,
      score: r.similarity,
    }));
  }

  async chunkCount(kbId: string): Promise<number> {
    if (!isDbEnabled()) return 0;
    const db = (await getDb()) as PrismaClient | null;
    if (!db) return 0;
    const rows = await db.$queryRaw<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM kb_chunks WHERE kb_id = $1`,
      kbId
    );
    return rows[0]?.count ?? 0;
  }
}
