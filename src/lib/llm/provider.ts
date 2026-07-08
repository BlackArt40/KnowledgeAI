// ---------------------------------------------------------------------------
// LLM Provider — abstraction over OpenAI-compatible APIs with graceful
// fallback to local implementations when no API key is configured.
//
// When OPENAI_API_KEY is set → real OpenAI (or any OpenAI-compatible endpoint
// via OPENAI_BASE_URL, e.g. Azure, vLLM, Ollama, DeepSeek).
// Otherwise → local hash embeddings + extractive generation (demo mode).
// ---------------------------------------------------------------------------

import { embed as localEmbed, cosine } from "@/lib/rag/embeddings";
import type { ChatMessage, ChatOptions } from "./types";

/** Whether a real LLM provider is configured. */
export function isLLMEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

function baseUrl(): string {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

function apiKey(): string {
  return process.env.OPENAI_API_KEY || "";
}

export function chatModel(): string {
  return process.env.CHAT_MODEL || "gpt-4o-mini";
}

export function embeddingModel(): string {
  return process.env.EMBEDDING_MODEL || "text-embedding-3-small";
}

export function llmLabel(): string {
  return isLLMEnabled() ? `${chatModel()} (OpenAI)` : "本地抽取式（演示模式）";
}

// ── Embeddings ──────────────────────────────────────────────────────────

/**
 * Embed text into a vector. Uses OpenAI if configured, else local hash.
 * Local returns Float32Array(2048); OpenAI returns Float32Array(1536|3072).
 * The vector store handles any dimension — just don't mix providers.
 */
export async function embedText(text: string): Promise<Float32Array> {
  if (!isLLMEnabled()) return localEmbed(text);

  const res = await fetch(`${baseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({ model: embeddingModel(), input: text }),
  });
  if (!res.ok) {
    console.error("[llm] embedding failed:", res.status, await res.text());
    return localEmbed(text); // graceful fallback
  }
  const data = await res.json();
  return new Float32Array(data.data[0].embedding);
}

/** Batch embed multiple texts (OpenAI supports batch input; local loops). */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (!isLLMEnabled()) return texts.map((t) => localEmbed(t));

  const res = await fetch(`${baseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({ model: embeddingModel(), input: texts }),
  });
  if (!res.ok) {
    console.error("[llm] batch embedding failed:", res.status);
    return texts.map((t) => localEmbed(t));
  }
  const data = await res.json();
  return data.data.map((d: { embedding: number[] }) => new Float32Array(d.embedding));
}

// ── Chat Completion ─────────────────────────────────────────────────────

/** Non-streaming chat completion → full text. */
export async function chatComplete(
  messages: ChatMessage[],
  opts?: ChatOptions
): Promise<string> {
  if (!isLLMEnabled()) return "";

  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: chatModel(),
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens,
      stream: false,
    }),
  });
  if (!res.ok) {
    console.error("[llm] chat failed:", res.status, await res.text());
    return "";
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** Streaming chat completion → async generator of text deltas. */
export async function* chatStream(
  messages: ChatMessage[],
  opts?: ChatOptions
): AsyncGenerator<string> {
  if (!isLLMEnabled()) return;

  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: chatModel(),
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    console.error("[llm] chat stream failed:", res.status);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {
        // skip malformed lines
      }
    }
  }
}

export { cosine };
