import { embedText } from "@/lib/llm/provider";
import { search } from "./vector-store";
import type { RetrievedChunk } from "./types";

// retrieve(kbId, query, topK) - embeds the query and returns top-K chunks.
// Uses LLM embeddings (OpenAI) if configured, else local hash.
export async function retrieve(
  kbId: string,
  query: string,
  topK: number
): Promise<RetrievedChunk[]> {
  const qv = await embedText(query);
  const results = await search(kbId, qv, topK);
  return results.map((r) => ({ ...r }));
}
