// ---------------------------------------------------------------------------
// Reranker - LLM-based reranking of retrieval candidates.
//
// After hybrid retrieval produces a candidate pool, the reranker asks the
// configured LLM to reorder the candidates by relevance to the query. This
// improves Top-K precision beyond what rank-fusion alone achieves, because
// the LLM can assess semantic relevance that vector distance and keyword
// overlap miss.
//
// Graceful fallback: when no LLM is configured (demo mode) or RERANK_ENABLED
// is "false", rerank() returns the candidates in their original order.
// ---------------------------------------------------------------------------

import { chatComplete, isLLMEnabled } from "@/lib/llm/provider";
import type { RetrievedChunk } from "./types";

function rerankEnabled(): boolean {
  return process.env.RERANK_ENABLED !== "false";
}

function rerankCandidates(): number {
  const v = parseInt(process.env.RERANK_CANDIDATES || "20", 10);
  return Number.isFinite(v) && v > 0 ? v : 20;
}

/**
 * Rerank retrieval candidates by LLM-assessed relevance to the query.
 * Returns the top-K most relevant chunks. Falls back to original order
 * when LLM is unavailable or reranking is disabled.
 */
export async function rerank(
  query: string,
  chunks: RetrievedChunk[],
  topK: number
): Promise<RetrievedChunk[]> {
  if (chunks.length <= 1) return chunks.slice(0, topK);
  if (!rerankEnabled()) return chunks.slice(0, topK);

  const llmOn = await isLLMEnabled();
  if (!llmOn) return chunks.slice(0, topK);

  try {
    const candidates = chunks.slice(0, rerankCandidates());
    const labeled = candidates
      .map((c, i) => `[${i}] ${c.text.slice(0, 500)}`)
      .join("\n\n");

    const systemPrompt =
      "You are a relevance ranking expert. Given a user query and candidate text passages (each labeled [0], [1], etc.), " +
      "return ONLY a comma-separated list of indices ordered by relevance to the query, most relevant first. " +
      "Do not include any other text. Example output: 3,0,1,2";

    const userPrompt = `Query: ${query}\n\nCandidates:\n${labeled}`;

    const response = await chatComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0, maxTokens: 200 }
    );

    const order = parseIndexList(response, candidates.length);
    if (order.length === 0) return chunks.slice(0, topK);

    const reranked = order
      .map((idx) => candidates[idx])
      .filter((c): c is RetrievedChunk => c !== undefined);
    return reranked.slice(0, topK);
  } catch (err) {
    console.warn("[rerank] failed, returning original order:", err instanceof Error ? err.message : err);
    return chunks.slice(0, topK);
  }
}

/** Parse a comma-separated index list from the LLM response.
 *  Returns valid indices within [0, maxIndex]. Empty on parse failure. */
export function parseIndexList(response: string, maxIndex: number): number[] {
  if (!response) return [];
  const tokens = response
    .replace(/[\[\]]/g, "")
    .split(/[,\s\n]+/)
    .map((t) => t.trim())
    .filter((t) => /^\d+$/.test(t));
  const seen = new Set<number>();
  const result: number[] = [];
  for (const t of tokens) {
    const idx = parseInt(t, 10);
    if (idx >= 0 && idx <= maxIndex && !seen.has(idx)) {
      seen.add(idx);
      result.push(idx);
    }
  }
  return result;
}

export const __test = { rerankEnabled, rerankCandidates };
