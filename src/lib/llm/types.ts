// LLM provider abstraction types.
// Used by RAG (embeddings + generation) and Agent orchestrator.

/** P7-4: one image attachment on a user message (base64 data). */
export interface ChatImage {
  mime: string; // e.g. "image/png"
  data: string; // base64-encoded bytes
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** P7-4: multimodal - images attached to a user message. Mapped to
   *  OpenAI content parts ({type:"image_url"}) when a real LLM is used. */
  images?: ChatImage[];
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** M-10: client-disconnect abort - propagated to the underlying LLM fetch
   *  so a dropped SSE connection stops burning tokens immediately. */
  signal?: AbortSignal;
}

export interface EmbeddingOptions {
  model?: string;
}
