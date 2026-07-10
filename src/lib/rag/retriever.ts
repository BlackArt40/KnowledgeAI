import { embedText } from "@/lib/llm/provider";
import { hybridSearch } from "./hybrid-search";
import type { RetrievedChunk } from "./types";

// retrieve(kbId, query, topK) - hybrid retrieval combining vector (semantic)
// and BM25 (keyword) search via Reciprocal Rank Fusion.
// Falls back to vector-only when BM25 index is empty.
export async function retrieve(
  kbId: string,
  query: string,
  topK: number
): Promise<RetrievedChunk[]> {
  const qv = await embedText(query);
  return hybridSearch(kbId, query, qv, { topK });
}
