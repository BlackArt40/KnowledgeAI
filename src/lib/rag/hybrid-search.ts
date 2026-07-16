// ---------------------------------------------------------------------------
// Hybrid Search - combines vector (semantic) and BM25 (keyword) retrieval
// using Reciprocal Rank Fusion (RRF).
//
// RRF merges two ranked lists into one by scoring each item as:
//   score = 1 / (k + rank_in_list)
// where k is a smoothing constant (default 60).
//
// This approach requires no score calibration between the two systems and
// consistently outperforms either method alone.
//
// References: Cormack et al., "Reciprocal Rank Fusion outperforms Condorcet
//             and individual rank learning methods" (SIGIR 2009)
// ---------------------------------------------------------------------------

import { search } from "./vector-store";
import { searchBM25 } from "./bm25";
import type { RetrievedChunk } from "./types";

const RRF_K = 60; // standard RRF constant

export interface HybridSearchOptions {
  topK?: number;
  /** Weight for vector search (0-1, default 0.5 = equal) */
  vectorWeight?: number;
  /** Weight for BM25 search (0-1, default 0.5 = equal) */
  keywordWeight?: number;
  /** Filter by document IDs (only return chunks from these docs) */
  docIdFilter?: string[];
  /** Only return chunks from documents uploaded after this timestamp (ms epoch) */
  createdAfter?: number;
}

/**
 * Hybrid retrieval combining vector + BM25 via RRF.
 * Falls back to vector-only when BM25 index is empty.
 */
export async function hybridSearch(
  kbId: string,
  query: string,
  queryVec: Float32Array,
  options?: HybridSearchOptions
): Promise<RetrievedChunk[]> {
  const topK = options?.topK ?? 5;
  const vWeight = options?.vectorWeight ?? 0.5;
  const kWeight = options?.keywordWeight ?? 0.5;
  let docFilter = options?.docIdFilter
    ? new Set(options.docIdFilter)
    : null;

  // createdAfter: restrict to documents uploaded after a timestamp
  if (options?.createdAfter) {
    try {
      const { listDocuments } = await import("@/lib/kb/store");
      const docs = listDocuments(kbId);
      const recent = new Set(
        docs.filter((d) => d.uploadedAt > options.createdAfter!).map((d) => d.id)
      );
      docFilter = docFilter
        ? new Set([...docFilter].filter((id) => recent.has(id)))
        : recent;
    } catch {
      // KB store unavailable - createdAfter filter cannot be applied
    }
  }

  // Fetch more candidates than topK for better fusion
  const candidateK = Math.max(topK * 3, 15);

  // Run both searches in parallel
  const [vectorResults, bm25Results] = await Promise.all([
    search(kbId, queryVec, candidateK),
    Promise.resolve(searchBM25(kbId, query, candidateK)),
  ]);

  // Apply document filter
  const vFiltered = docFilter
    ? vectorResults.filter((r) => docFilter.has(r.docId))
    : vectorResults;
  const bFiltered = docFilter
    ? bm25Results.filter((r) => docFilter.has(r.docId))
    : bm25Results;

  // If BM25 is empty, return vector results directly
  if (bFiltered.length === 0) {
    return vFiltered.slice(0, topK);
  }
  // If vector is empty, return BM25 results directly
  if (vFiltered.length === 0) {
    return bFiltered.slice(0, topK).map((r) => ({
      docId: r.docId,
      docName: r.docName,
      chunkIndex: r.chunkIndex,
      text: r.text,
      score: r.score,
    }));
  }

  // RRF fusion
  const rrfScores = new Map<string, { chunk: RetrievedChunk; score: number }>();

  // Vector results (ranked by cosine similarity)
  vFiltered.forEach((r, rank) => {
    const key = `${r.docId}:${r.chunkIndex}`;
    const rrfScore = vWeight * (1 / (RRF_K + rank + 1));
    rrfScores.set(key, {
      chunk: { ...r, score: rrfScore },
      score: rrfScore,
    });
  });

  // BM25 results (ranked by BM25 score)
  bFiltered.forEach((r, rank) => {
    const key = `${r.docId}:${r.chunkIndex}`;
    const rrfScore = kWeight * (1 / (RRF_K + rank + 1));
    const existing = rrfScores.get(key);
    if (existing) {
      existing.score += rrfScore;
      existing.chunk.score = existing.score;
    } else {
      rrfScores.set(key, {
        chunk: {
          docId: r.docId,
          docName: r.docName,
          chunkIndex: r.chunkIndex,
          text: r.text,
          score: rrfScore,
        },
        score: rrfScore,
      });
    }
  });

  // Sort by fused RRF score and return top-K
  return Array.from(rrfScores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((v) => v.chunk);
}
