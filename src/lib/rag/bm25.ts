// ---------------------------------------------------------------------------
// BM25 Keyword Index - per-KB in-memory BM25 retrieval via miniSearch.
//
// miniSearch is a mature zero-dependency BM25 library (CJK-aware via a custom
// tokenizer); replaced the hand-rolled BM25 + tokenizer in 2026-08 (P7-5).
// Combined with vector (semantic) search via RRF, it creates a hybrid
// retrieval system that excels at both keyword matching and semantic
// understanding.
//
// 🔌 Production: replace with PostgreSQL full-text search (tsvector) or
//    Elasticsearch for scalability.
// ---------------------------------------------------------------------------

import MiniSearch from "minisearch";

/** docId::chunkIndex - miniSearch needs unique per-chunk document ids. */
function chunkId(docId: string, chunkIndex: number): string {
  return `${docId}::${chunkIndex}`;
}

interface StoredChunk {
  id: string;
  docId: string;
  docName: string;
  chunkIndex: number;
  text: string;
}

/**
 * Tokenizer: latin words (2+ chars) + CJK unigrams + CJK bigrams.
 * CJK bigrams improve matching without a real segmenter (same strategy as
 * the previous hand-rolled tokenizer).
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();

  // Latin words (2+ chars)
  tokens.push(...(lower.match(/[a-z][a-z0-9]+/g) ?? []));

  // CJK unigrams
  const cjkMatches = lower.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? [];
  tokens.push(...cjkMatches);

  // CJK bigrams (for better matching)
  for (let i = 0; i < cjkMatches.length - 1; i++) {
    tokens.push(cjkMatches[i] + cjkMatches[i + 1]);
  }

  return tokens;
}

const g = globalThis as unknown as {
  __KAI_BM25__?: Map<string, MiniSearch<StoredChunk>>;
  __KAI_BM25_DOCS__?: Map<string, Map<string, string[]>>; // kbId -> docId -> chunk ids
};

function store(): Map<string, MiniSearch<StoredChunk>> {
  if (!g.__KAI_BM25__) g.__KAI_BM25__ = new Map();
  return g.__KAI_BM25__;
}

/** Track which chunk ids belong to which doc, for re-index / delete. */
function docIndex(): Map<string, Map<string, string[]>> {
  if (!g.__KAI_BM25_DOCS__) g.__KAI_BM25_DOCS__ = new Map();
  return g.__KAI_BM25_DOCS__;
}

/** miniSearch.discard throws for unknown ids - idempotent wrapper. */
function discardSafe(ms: MiniSearch<StoredChunk>, id: string): void {
  try {
    ms.discard(id);
  } catch {
    // not in the index (e.g. the index was reset) - nothing to remove
  }
}

function getIndex(kbId: string): MiniSearch<StoredChunk> {
  const s = store();
  let ms = s.get(kbId);
  if (!ms) {
    ms = new MiniSearch<StoredChunk>({
      fields: ["text"],
      storeFields: ["docId", "docName", "chunkIndex", "text"],
      tokenize,
      searchOptions: { boost: { text: 1 } },
    });
    s.set(kbId, ms);
    // A fresh index invalidates any surviving chunk-id tracking (e.g. when
    // __KAI_BM25__ was reset while the tracking map lived on).
    docIndex().delete(kbId);
  }
  return ms;
}

// ── Index management ─────────────────────────────────────────────────────

/** Index document chunks into the per-KB BM25 index. */
export function indexBM25(
  kbId: string,
  docId: string,
  docName: string,
  chunks: string[]
): void {
  const ms = getIndex(kbId);

  // Remove existing chunks for this document (re-index safe)
  const docs = docIndex();
  let kbDocs = docs.get(kbId);
  if (!kbDocs) {
    kbDocs = new Map();
    docs.set(kbId, kbDocs);
  }
  const oldIds = kbDocs.get(docId) ?? [];
  for (const id of oldIds) discardSafe(ms, id);

  // Add new chunks
  const newIds: string[] = chunks.map((text, chunkIndex) => {
    const id = chunkId(docId, chunkIndex);
    ms.add({ id, docId, docName, chunkIndex, text });
    return id;
  });
  kbDocs.set(docId, newIds);
}

/** Remove all chunks for a specific document from the BM25 index. */
export function clearBM25Doc(kbId: string, docId: string): void {
  const kbDocs = docIndex().get(kbId);
  const ids = kbDocs?.get(docId) ?? [];
  const ms = store().get(kbId);
  if (ms) {
    for (const id of ids) discardSafe(ms, id);
  }
  kbDocs?.delete(docId);
}

/** Remove the entire BM25 index for a KB. */
export function clearBM25Kb(kbId: string): void {
  store().delete(kbId);
  docIndex().delete(kbId);
}

// ── BM25 Search ──────────────────────────────────────────────────────────

export interface BM25Result {
  docId: string;
  docName: string;
  chunkIndex: number;
  text: string;
  score: number;
}

/**
 * Search the BM25 index for top-K matching chunks.
 * Uses miniSearch's BM25 (k1=1.5, b=0.75, d=0.5 - the v7 `bm25` option lives
 * in the search call, not the constructor).
 */
export function searchBM25(
  kbId: string,
  query: string,
  topK: number
): BM25Result[] {
  const ms = store().get(kbId);
  if (!ms) return [];
  if (tokenize(query).length === 0) return [];

  return ms
    .search(query, { bm25: { k: 1.5, b: 0.75, d: 0.5 } })
    .slice(0, topK)
    .map((r) => ({
      docId: r.docId,
      docName: r.docName,
      chunkIndex: r.chunkIndex,
      text: r.text,
      score: r.score,
    }));
}

/** Count chunks in the BM25 index for a KB. */
export function bm25ChunkCount(kbId: string): number {
  return store().get(kbId)?.documentCount ?? 0;
}
