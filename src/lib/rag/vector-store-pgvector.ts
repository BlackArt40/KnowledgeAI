// ---------------------------------------------------------------------------
// PgVectorStore - PostgreSQL + pgvector extension for production vector search.
//
// Requires:
//   1. PostgreSQL with pgvector extension: CREATE EXTENSION vector;
//   2. VECTOR_STORE=pgvector + DATABASE_URL in .env.local
//   3. @prisma/client installed
//
// Uses Prisma raw queries for vector operations ($queryRawUnsafe / $executeRawUnsafe).
//
// ANN index: HNSW on the embedding column. pgvector caps HNSW at 2000
// dimensions, so wider embeddings (e.g. Qwen3-Embedding-8B = 4096) skip the
// ANN index and fall back to an exact scan - correct, just slower. Logged once
// per process so the downgrade is visible instead of silent.
//
// Table schema (auto-created on first use):
//   CREATE TABLE IF NOT EXISTS kb_chunks (
//     id          TEXT PRIMARY KEY,
//     kb_id       TEXT NOT NULL,
//     doc_id      TEXT NOT NULL,
//     doc_name    TEXT NOT NULL,
//     chunk_index INT NOT NULL,
//     text        TEXT NOT NULL,
//     embedding   vector(<dim>)
//   );
//   CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);  -- dim <= 2000 only
//
// Concurrency: app and worker both call ensureSchema() against the same DB.
// CREATE ... IF NOT EXISTS still races at the catalog level (duplicate
// pg_class entry / 23505), so DDL here tolerates those benign errors.
// ---------------------------------------------------------------------------

import { getDb, isDbEnabled } from "@/lib/db/client";
import { log } from "@/lib/obs/log";
import type { VectorStore, SearchResult } from "./vector-store-interface";

// Prisma client shape for raw queries (avoids importing @prisma/client types)
interface PrismaClient {
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]>;
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
}

/** pgvector HNSW indexes support at most 2000 dimensions. */
const HNSW_MAX_DIM = 2000;
/** pgvector `vector` columns support up to 16000 dimensions. */
const VECTOR_MAX_DIM = 16000;

let initialized = false;
let vectorDim = 0;
const warned = new Set<string>();

function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  log.warn(msg);
}

function errCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** CREATE ... IF NOT EXISTS can still lose a race in another process. */
function isConcurrentDdlRace(err: unknown): boolean {
  const code = errCode(err);
  // 23505 unique_violation (pg_class), 42P07 duplicate_table, 42710 duplicate_object
  return code === "23505" || code === "42P07" || code === "42710";
}

/** The kb_chunks table has not been created yet - nothing to read/clear. */
function isUndefinedTable(err: unknown): boolean {
  return errCode(err) === "42P01";
}

/** Query/index dims disagree with the indexed column - treat as no matches. */
function isDimMismatch(err: unknown): boolean {
  return err instanceof Error && /different vector dimensions/i.test(err.message);
}

/** Run DDL, ignoring benign concurrent-create errors. */
async function execDdl(db: PrismaClient, sql: string): Promise<void> {
  try {
    await db.$executeRawUnsafe(sql);
  } catch (err) {
    if (isConcurrentDdlRace(err)) return;
    throw err;
  }
}

/** Detect vector dimension from the first embedding we see. */
function detectDim(vectors: Float32Array[]): number {
  if (vectors.length > 0 && vectors[0].length > 0) return vectors[0].length;
  return 1536; // default OpenAI embedding dim
}

function assertValidDim(dim: number): number {
  const d = Math.trunc(dim);
  if (!Number.isFinite(d) || d <= 0 || d > VECTOR_MAX_DIM) {
    throw new Error(`invalid pgvector dimension: ${dim}`);
  }
  return d;
}

/** Convert Float32Array to pgvector string format: "[0.1,0.2,...]" */
function toPgVector(v: Float32Array): string {
  return `[${Array.from(v).join(",")}]`;
}

/** Ensure the kb_chunks table + indexes exist (idempotent, race-tolerant). */
async function ensureSchema(db: PrismaClient, rawDim: number): Promise<void> {
  const dim = assertValidDim(rawDim);
  if (initialized && dim === vectorDim) return;

  await execDdl(
    db,
    `CREATE TABLE IF NOT EXISTS kb_chunks (
       id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       kb_id       TEXT NOT NULL,
       doc_id      TEXT NOT NULL,
       doc_name    TEXT NOT NULL,
       chunk_index INT NOT NULL,
       text        TEXT NOT NULL,
       embedding   vector(${dim})
     )`
  );
  await execDdl(db, `CREATE INDEX IF NOT EXISTS idx_kb_chunks_kb ON kb_chunks (kb_id)`);
  await execDdl(db, `CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks (doc_id)`);

  if (dim <= HNSW_MAX_DIM) {
    await execDdl(
      db,
      `CREATE INDEX IF NOT EXISTS idx_kb_chunks_emb
         ON kb_chunks USING hnsw (embedding vector_cosine_ops)`
    );
  } else {
    // Exact scan still returns correct results; only recall latency differs.
    warnOnce(
      `hnsw:${dim}`,
      `[rag] embedding dim ${dim} > pgvector HNSW limit ${HNSW_MAX_DIM}; skipping ANN index (exact scan)`
    );
  }

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
  private async db(): Promise<PrismaClient | null> {
    if (!isDbEnabled()) return null;
    return (await getDb()) as PrismaClient | null;
  }

  async indexChunks(
    kbId: string,
    docId: string,
    docName: string,
    chunks: string[],
    vectors: Float32Array[]
  ): Promise<void> {
    const db = await this.db();
    if (!db) return;

    await ensureSchema(db, detectDim(vectors));

    // Remove existing chunks for this doc (re-index safe)
    await db.$executeRawUnsafe(
      `DELETE FROM kb_chunks WHERE kb_id = $1 AND doc_id = $2`,
      kbId,
      docId
    );

    // Batch insert
    for (let i = 0; i < chunks.length; i++) {
      await db.$executeRawUnsafe(
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
    const db = await this.db();
    if (!db) return;
    try {
      await db.$executeRawUnsafe(
        `DELETE FROM kb_chunks WHERE kb_id = $1 AND doc_id = $2`,
        kbId,
        docId
      );
    } catch (err) {
      // Never indexed -> the table may not exist yet. Clearing is a no-op.
      if (isUndefinedTable(err)) return;
      throw err;
    }
  }

  async clearKb(kbId: string): Promise<void> {
    const db = await this.db();
    if (!db) return;
    try {
      await db.$executeRawUnsafe(`DELETE FROM kb_chunks WHERE kb_id = $1`, kbId);
    } catch (err) {
      if (isUndefinedTable(err)) return;
      throw err;
    }
  }

  async search(
    kbId: string,
    queryVec: Float32Array,
    topK: number
  ): Promise<SearchResult[]> {
    const db = await this.db();
    if (!db) return [];

    try {
      await ensureSchema(db, queryVec.length);

      // Cosine distance via pgvector <=> operator (1 - cosine_similarity)
      const rows = await db.$queryRawUnsafe<PgChunkRow>(
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
    } catch (err) {
      if (isUndefinedTable(err)) return [];
      if (isDimMismatch(err)) {
        warnOnce(
          "dim-mismatch",
          "[rag] query embedding dimension differs from the indexed column; returning no matches"
        );
        return [];
      }
      throw err;
    }
  }

  async chunkCount(kbId: string): Promise<number> {
    const db = await this.db();
    if (!db) return 0;
    try {
      const rows = await db.$queryRawUnsafe<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM kb_chunks WHERE kb_id = $1`,
        kbId
      );
      return rows[0]?.count ?? 0;
    } catch (err) {
      if (isUndefinedTable(err)) return 0;
      throw err;
    }
  }
}
