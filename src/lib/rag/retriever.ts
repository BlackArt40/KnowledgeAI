// ---------------------------------------------------------------------------
// Retriever - orchestration entry point for RAG retrieval.
//
// Pipeline: query rewrite (multi-query fusion) -> hybrid search (vector +
// BM25 RRF per query) -> cross-query RRF fusion -> LLM reranking -> top-K.
//
// Every stage gracefully degrades: when no LLM is configured (demo mode),
// query rewrite returns [originalQuery] and reranking is a no-op, so the
// pipeline collapses to the original hybridSearch behavior.
// ---------------------------------------------------------------------------

import { embedText } from "@/lib/llm/provider";
import { hybridSearch } from "./hybrid-search";
import { rewriteQuery } from "./query-rewrite";
import { rerank } from "./reranker";
import type { RetrievedChunk } from "./types";

const MULTI_QUERY_RRF_K = 60;

function candidatePoolSize(): number {
  const v = parseInt(process.env.RERANK_CANDIDATES || "20", 10);
  return Number.isFinite(v) && v > 0 ? v : 20;
}

/** Retrieve candidates from multiple queries, fused via RRF across queries. */
async function multiQueryRetrieve(
  kbId: string,
  queries: string[],
  candidateK: number
): Promise<RetrievedChunk[]> {
  const perQueryResults = await Promise.all(
    queries.map(async (q) => {
      const qv = await embedText(q);
      return hybridSearch(kbId, q, qv, { topK: candidateK });
    })
  );

  if (perQueryResults.length === 1) return perQueryResults[0];

  const fused = new Map<string, { chunk: RetrievedChunk; score: number }>();
  for (const results of perQueryResults) {
    results.forEach((r, rank) => {
      const key = `${r.docId}:${r.chunkIndex}`;
      const rrfScore = 1 / (MULTI_QUERY_RRF_K + rank + 1);
      const existing = fused.get(key);
      if (existing) {
        existing.score += rrfScore;
        existing.chunk.score = existing.score;
      } else {
        fused.set(key, { chunk: { ...r, score: rrfScore }, score: rrfScore });
      }
    });
  }

  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score)
    .map((v) => v.chunk)
    .slice(0, candidateK);
}

/**
 * Retrieve top-K chunks for a query using the full enhanced pipeline:
 * query rewrite -> multi-query hybrid search -> cross-query RRF fusion ->
 * LLM reranking. Interface unchanged from original; all enhancements are
 * env-gated with graceful demo fallback.
 */
export async function retrieve(
  kbId: string,
  query: string,
  topK: number
): Promise<RetrievedChunk[]> {
  const queries = await rewriteQuery(query);
  const candidateK = Math.max(candidatePoolSize(), topK);
  const candidates = await multiQueryRetrieve(kbId, queries, candidateK);
  return rerank(query, candidates, topK);
}
