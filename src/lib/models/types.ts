// ---------------------------------------------------------------------------
// External model configuration types.
// Supports any OpenAI-compatible API (OpenAI, DeepSeek, Ollama, SiliconFlow,
// Azure, vLLM, etc.) so users can bring their own LLM for RAG + Agent.
// ---------------------------------------------------------------------------

export type ProviderId =
  | "openai"
  | "deepseek"
  | "ollama"
  | "siliconflow"
  | "moonshot"
  | "custom";

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  baseUrl: string;
  docsUrl: string;
  needsKey: boolean;
  keyPlaceholder: string;
  chatModels: string[];
  embeddingModels: string[];
  keyHint: string;
}

export interface ModelConfig {
  id: string;
  name: string;            // user-friendly label
  provider: ProviderId;
  providerName: string;    // resolved display name
  apiKey: string;          // stored plaintext (demo); prod -> encrypt / vault
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;  // empty = skip remote embeddings, use local
  enabled: boolean;
  isDefault: boolean;
  lastTestedAt: number | null;
  lastTestOk: boolean | null;
  createdAt: number;
}

/** Shape returned to the client (API key masked). */
export type ModelConfigSafe = Omit<ModelConfig, "apiKey"> & {
  apiKeyMasked: string;
  hasKey: boolean;
};
