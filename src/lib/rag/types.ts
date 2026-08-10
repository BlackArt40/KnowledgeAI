import type { SourceType } from "@/lib/external/types";

export interface RetrievedChunk {
  docId: string;
  docName: string;
  chunkIndex: number;
  text: string;
  score: number;
  /** External/web source URL. Present when this chunk is from web search. */
  url?: string;
  /** External source type. Present when this chunk is from web search. */
  sourceType?: SourceType;
}

export interface Citation {
  n: number; // 1-based marker shown inline
  docId: string;
  docName: string;
  chunkIndex: number;
  snippet: string;
  score: number;
  /** External/web source URL. Present when this citation is from web search. */
  url?: string;
  /** External source type. Present when this citation is from web search. */
  sourceType?: SourceType;
}

export interface GenerationResult {
  text: string; // answer text with [n] markers
  citations: Citation[];
}

export interface RagSettings {
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
}
