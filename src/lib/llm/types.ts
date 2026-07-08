// LLM provider abstraction types.
// Used by RAG (embeddings + generation) and Agent orchestrator.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface EmbeddingOptions {
  model?: string;
}
