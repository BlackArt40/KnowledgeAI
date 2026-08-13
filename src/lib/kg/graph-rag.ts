// ---------------------------------------------------------------------------
// GraphRAG hybrid retrieval (P7-3).
//
// Augments the vector/BM25 retrieval with knowledge-graph evidence:
//   1. extract query entities (pattern NER - cheap, deterministic)
//   2. expand them 1-2 hops through the KB graph to NEIGHBOR entities
//   3. boost chunks that mention the neighbors (the answer often cites the
//      neighbor, not the query entity itself)
//
// Scoring: score × (1 + NEIGHBOR_BOOST × min(neighborMentions, cap)). Only
// NEIGHBOR labels are boosted - query entities already rank via plain
// retrieval, so boosting them would just amplify term-repetition distractors.
// ---------------------------------------------------------------------------

import type { RetrievedChunk } from "@/lib/rag/types";
import { extractEntities } from "./extract";
import { getEntityByLabel, expandEntities } from "./store";

/** Boost factor for chunks mentioning graph neighbors. */
export const NEIGHBOR_BOOST = 0.8;
const MENTION_CAP = 4;

export interface GraphRagResult {
  chunks: RetrievedChunk[];
  /** Entity labels matched in the KB graph (query entities + neighbors). */
  matchedLabels: string[];
  neighborLabels: string[];
}

/**
 * Re-rank retrieved chunks using knowledge-graph entity expansion.
 * Returns the same chunks re-sorted; deterministic in demo mode.
 */
export function graphRankChunks(
  kbId: string,
  query: string,
  chunks: RetrievedChunk[],
  opts: { hops?: number } = {}
): GraphRagResult {
  const queryEntities = extractEntities(query, { llm: false });
  if (queryEntities.length === 0) {
    return { chunks, matchedLabels: [], neighborLabels: [] };
  }

  // Query entities that actually exist in the KB graph.
  const matched = queryEntities.filter((m) => getEntityByLabel(kbId, m.label));
  if (matched.length === 0) {
    return { chunks, matchedLabels: [], neighborLabels: [] };
  }
  const matchedLabels = matched.map((m) => m.label);

  // 1-hop neighbors with aggregate edge weights.
  const neighbors = expandEntities(kbId, matchedLabels, opts.hops ?? 1);
  const neighborLabels = [...neighbors.keys()];

  const boosted = chunks.map((c) => {
    let neighborMentions = 0;
    for (const label of neighborLabels) {
      if (c.text.includes(label)) neighborMentions += 1;
    }
    const hit = Math.min(neighborMentions, MENTION_CAP);
    if (hit > 0) {
      return { ...c, score: c.score * (1 + NEIGHBOR_BOOST * hit) };
    }
    return c;
  });

  const sorted = [...boosted].sort((a, b) => b.score - a.score);
  return { chunks: sorted, matchedLabels, neighborLabels };
}
