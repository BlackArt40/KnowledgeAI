export interface RetrievedChunk {
  docId: string;
  docName: string;
  chunkIndex: number;
  text: string;
  score: number;
}

export interface Citation {
  n: number; // 1-based marker shown inline
  docId: string;
  docName: string;
  chunkIndex: number;
  snippet: string;
  score: number;
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
