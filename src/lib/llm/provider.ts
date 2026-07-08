// ---------------------------------------------------------------------------
// LLM Provider - abstraction over OpenAI-compatible APIs with graceful
// fallback to local implementations when no provider is configured.
//
// Resolution order:
//   1. User-configured model in models store (enabled)  ← runtime config
//   2. Environment variables (OPENAI_API_KEY etc.)       ← deploy-time config
//   3. Local hash embeddings + extractive generation     ← demo mode
// ---------------------------------------------------------------------------

import { embed as localEmbed, cosine } from "@/lib/rag/embeddings";
import type { ChatMessage, ChatOptions } from "./types";

interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  label: string;
}

/** Resolve the active LLM config: user model store -> env -> null (demo). */
async function resolveConfig(): Promise<ResolvedConfig | null> {
  // 1. User-configured models (dynamic import to avoid circular deps at load)
  try {
    const { getActiveModel } = await import("@/lib/models/store");
    const active = getActiveModel();
    if (active && active.enabled) {
      return {
        apiKey: active.apiKey,
        baseUrl: active.baseUrl.replace(/\/$/, ""),
        chatModel: active.chatModel,
        embeddingModel: active.embeddingModel || "text-embedding-3-small",
        label: `${active.chatModel} (${active.providerName})`,
      };
    }
  } catch {
    // store not available - fall through to env
  }

  // 2. Environment variables
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      chatModel: process.env.CHAT_MODEL || "gpt-4o-mini",
      embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
      label: `${process.env.CHAT_MODEL || "gpt-4o-mini"} (OpenAI)`,
    };
  }

  // 3. Demo mode
  return null;
}

/** Whether a real LLM provider is configured (user model or env). */
export async function isLLMEnabled(): Promise<boolean> {
  return (await resolveConfig()) !== null;
}

export async function chatModel(): Promise<string> {
  return (await resolveConfig())?.chatModel ?? "local";
}

export async function embeddingModel(): Promise<string> {
  return (await resolveConfig())?.embeddingModel ?? "local";
}

export async function llmLabel(): Promise<string> {
  return (await resolveConfig())?.label ?? "本地抽取式（演示模式）";
}

// ── Embeddings ──────────────────────────────────────────────────────────

export async function embedText(text: string): Promise<Float32Array> {
  const cfg = await resolveConfig();
  if (!cfg || !cfg.embeddingModel || cfg.embeddingModel === "local") return localEmbed(text);

  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.embeddingModel, input: text }),
  });
  if (!res.ok) {
    console.error("[llm] embedding failed:", res.status, await res.text());
    return localEmbed(text); // graceful fallback
  }
  const data = await res.json();
  return new Float32Array(data.data[0].embedding);
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const cfg = await resolveConfig();
  if (!cfg || !cfg.embeddingModel || cfg.embeddingModel === "local") return texts.map((t) => localEmbed(t));

  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.embeddingModel, input: texts }),
  });
  if (!res.ok) {
    console.error("[llm] batch embedding failed:", res.status);
    return texts.map((t) => localEmbed(t));
  }
  const data = await res.json();
  return data.data.map((d: { embedding: number[] }) => new Float32Array(d.embedding));
}

// ── Chat Completion ─────────────────────────────────────────────────────

export async function chatComplete(
  messages: ChatMessage[],
  opts?: ChatOptions
): Promise<string> {
  const cfg = await resolveConfig();
  if (!cfg) return "";

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.chatModel,
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

export async function* chatStream(
  messages: ChatMessage[],
  opts?: ChatOptions
): AsyncGenerator<string> {
  const cfg = await resolveConfig();
  if (!cfg) return;

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.chatModel,
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
