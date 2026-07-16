// ---------------------------------------------------------------------------
// Query Rewrite - LLM-based multi-query fusion.
//
// Expands a user query into N alternative phrasings (synonyms, paraphrases).
// Each rewrite is retrieved independently and the results are fused via RRF,
// improving recall by catching relevant chunks that the original phrasing
// missed (e.g., different terminology, language variations).
//
// Graceful fallback: when no LLM is configured (demo mode) or
// QUERY_REWRITE_ENABLED is "false", returns [originalQuery] (no expansion).
// ---------------------------------------------------------------------------

import { chatComplete, isLLMEnabled } from "@/lib/llm/provider";

function rewriteEnabled(): boolean {
  return process.env.QUERY_REWRITE_ENABLED !== "false";
}

function rewriteCount(): number {
  const v = parseInt(process.env.QUERY_REWRITE_COUNT || "3", 10);
  return Number.isFinite(v) && v > 0 ? v : 3;
}

/**
 * Expand a query into N alternative phrasings via the LLM.
 * The returned array always includes the original query (first element).
 * Falls back to [query] when LLM is unavailable or rewrite is disabled.
 */
export async function rewriteQuery(query: string): Promise<string[]> {
  if (!rewriteEnabled()) return [query];

  const llmOn = await isLLMEnabled();
  if (!llmOn) return [query];

  try {
    const n = rewriteCount();
    const systemPrompt =
      "You are a search query expansion expert. Given a user query, generate alternative phrasings " +
      "that capture the same information need using different terminology, synonyms, or language. " +
      `Return exactly ${n} alternative queries, one per line. Do not number them or add any other text.`;

    const response = await chatComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      { temperature: 0.5, maxTokens: 200 }
    );

    const rewrites = parseQueryLines(response, n);
    if (rewrites.length === 0) return [query];
    return [query, ...rewrites];
  } catch (err) {
    console.warn("[query-rewrite] failed, returning original query:", err instanceof Error ? err.message : err);
    return [query];
  }
}

/** Parse LLM response into individual query lines.
 *  Filters empty/duplicate lines, caps at maxCount. */
export function parseQueryLines(response: string, maxCount: number): string[] {
  if (!response) return [];
  const lines = response
    .split("\n")
    .map((l) => l.replace(/^\d+[\.\)]\s*/, "").trim())
    .filter((l) => l.length > 0);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(line);
    }
    if (result.length >= maxCount) break;
  }
  return result;
}

export const __test = { rewriteEnabled, rewriteCount };
