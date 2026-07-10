// ---------------------------------------------------------------------------
// BM25 Keyword Index - per-KB in-memory BM25 retrieval.
//
// BM25 (Best Matching 25) is a ranking function that scores documents by
// term frequency and inverse document frequency. Combined with vector
// (semantic) search via RRF, it creates a hybrid retrieval system that
// excels at both keyword matching and semantic understanding.
//
// 🔌 Production: replace with PostgreSQL full-text search (tsvector) or
//    Elasticsearch for scalability.
// ---------------------------------------------------------------------------


interface BM25Doc {
  docId: string;
  docName: string;
  chunkIndex: number;
  text: string;
  tokens: string[];
}

interface BM25Index {
  docs: BM25Doc[];
  docFreq: Map<string, number>;  // term -> number of docs containing it
  avgDocLen: number;
  totalDocs: number;
}

const g = globalThis as unknown as { __KAI_BM25__?: Map<string, BM25Index> };

function store(): Map<string, BM25Index> {
  if (!g.__KAI_BM25__) g.__KAI_BM25__ = new Map();
  return g.__KAI_BM25__;
}

// ── Tokenizer ────────────────────────────────────────────────────────────

/** Tokenize text for BM25 indexing. Handles CJK characters (unigram) + latin words. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();

  // Latin words (2+ chars)
  const latinMatches = lower.match(/[a-z][a-z0-9]+/g) || [];
  tokens.push(...latinMatches);

  // CJK unigrams
  const cjkMatches = lower.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || [];
  tokens.push(...cjkMatches);

  // CJK bigrams (for better matching)
  for (let i = 0; i < cjkMatches.length - 1; i++) {
    tokens.push(cjkMatches[i] + cjkMatches[i + 1]);
  }

  return tokens;
}

// ── Index management ─────────────────────────────────────────────────────

/** Index document chunks into the per-KB BM25 index. */
export function indexBM25(
  kbId: string,
  docId: string,
  docName: string,
  chunks: string[]
): void {
  const s = store();
  let idx = s.get(kbId);
  if (!idx) {
    idx = { docs: [], docFreq: new Map(), avgDocLen: 0, totalDocs: 0 };
    s.set(kbId, idx);
  }

  // Remove existing docs for this document (re-index safe)
  idx.docs = idx.docs.filter((d) => d.docId !== docId);

  // Add new docs
  const newDocs: BM25Doc[] = chunks.map((text, chunkIndex) => ({
    docId,
    docName,
    chunkIndex,
    text,
    tokens: tokenize(text),
  }));

  // Recalculate document frequencies
  const allDocs = [...idx.docs, ...newDocs];
  const docFreq = new Map<string, number>();
  let totalLen = 0;
  for (const doc of allDocs) {
    totalLen += doc.tokens.length;
    const seen = new Set(doc.tokens);
    for (const term of seen) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  idx.docs = allDocs;
  idx.docFreq = docFreq;
  idx.totalDocs = allDocs.length;
  idx.avgDocLen = allDocs.length > 0 ? totalLen / allDocs.length : 0;
}

/** Remove all chunks for a specific document from the BM25 index. */
export function clearBM25Doc(kbId: string, docId: string): void {
  const idx = store().get(kbId);
  if (!idx) return;
  idx.docs = idx.docs.filter((d) => d.docId !== docId);
  // Recalculate
  const docFreq = new Map<string, number>();
  let totalLen = 0;
  for (const doc of idx.docs) {
    totalLen += doc.tokens.length;
    const seen = new Set(doc.tokens);
    for (const term of seen) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  idx.docFreq = docFreq;
  idx.totalDocs = idx.docs.length;
  idx.avgDocLen = idx.docs.length > 0 ? totalLen / idx.docs.length : 0;
}

/** Remove the entire BM25 index for a KB. */
export function clearBM25Kb(kbId: string): void {
  store().delete(kbId);
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
 * Uses standard BM25 with k1=1.5, b=0.75.
 */
export function searchBM25(
  kbId: string,
  query: string,
  topK: number
): BM25Result[] {
  const idx = store().get(kbId);
  if (!idx || idx.docs.length === 0) return [];

  const k1 = 1.5;
  const b = 0.75;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // Count query term frequencies
  const queryTf = new Map<string, number>();
  for (const token of queryTokens) {
    queryTf.set(token, (queryTf.get(token) ?? 0) + 1);
  }

  const results: BM25Result[] = [];
  for (const doc of idx.docs) {
    let score = 0;
    for (const [term, qtf] of queryTf) {
      const df = idx.docFreq.get(term) ?? 0;
      if (df === 0) continue;

      // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log(
        (idx.totalDocs - df + 0.5) / (df + 0.5) + 1
      );

      // Term frequency in document
      let tf = 0;
      for (const t of doc.tokens) {
        if (t === term) tf++;
      }
      if (tf === 0) continue;

      // BM25 score component
      const docLenNorm =
        1 - b + b * (doc.tokens.length / (idx.avgDocLen || 1));
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * docLenNorm);
      score += idf * tfNorm * qtf;
    }

    if (score > 0) {
      results.push({
        docId: doc.docId,
        docName: doc.docName,
        chunkIndex: doc.chunkIndex,
        text: doc.text,
        score,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** Count chunks in the BM25 index for a KB. */
export function bm25ChunkCount(kbId: string): number {
  return store().get(kbId)?.docs.length ?? 0;
}
