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
import { getCurrentUserId } from "@/lib/models/context";
import { recordLlm } from "@/lib/obs/metrics";
import { traceBegin, traceEnd } from "@/lib/obs/trace";
import { log, redactText } from "@/lib/obs/log";
import type { ChatMessage, ChatOptions } from "./types";

// P7-4: map ChatMessage (with optional base64 images) to the OpenAI wire
// format - a user message with images becomes a content array of text +
// image_url parts (vision models only when a real LLM is configured).
function wireMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.images && m.images.length > 0) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          ...m.images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mime};base64,${img.data}` },
          })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  label: string;
}

/** Resolve the EMBEDDING config: environment only, never per-user.
 *  Embeddings must be identical at index time and query time. Indexing has no
 *  user context, so embeddings cannot follow the per-request user model —
 *  otherwise query vectors and document vectors would live in different spaces
 *  and retrieval would silently return nothing / garbage. */
async function resolveEmbeddingConfig(): Promise<ResolvedConfig | null> {
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      chatModel: process.env.CHAT_MODEL || "gpt-4o-mini",
      embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
      label: `${process.env.EMBEDDING_MODEL || "text-embedding-3-small"} (OpenAI)`,
    };
  }
  return null;
}

/** Resolve the CHAT (generation) config: per-user model -> env -> null (demo).
 *  Only chat generation follows the per-request user context, since each user
 *  may bring their own chat LLM. Embeddings intentionally do NOT use this. */
async function resolveChatConfig(): Promise<ResolvedConfig | null> {
  const userId = getCurrentUserId();
  if (userId) {
    try {
      const { getActiveModelForUser } = await import("@/lib/models/store");
      const active = getActiveModelForUser(userId);
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
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      chatModel: process.env.CHAT_MODEL || "gpt-4o-mini",
      embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
      label: `${process.env.CHAT_MODEL || "gpt-4o-mini"} (OpenAI)`,
    };
  }

  return null;
}

/** Whether a real LLM provider is configured (user model or env). */
export async function isLLMEnabled(): Promise<boolean> {
  return (await resolveChatConfig()) !== null;
}

export async function chatModel(): Promise<string> {
  return (await resolveChatConfig())?.chatModel ?? "local";
}

export async function embeddingModel(): Promise<string> {
  return (await resolveEmbeddingConfig())?.embeddingModel ?? "local";
}

export async function llmLabel(): Promise<string> {
  return (await resolveChatConfig())?.label ?? "本地抽取式（演示模式）";
}

// ── Embeddings ──────────────────────────────────────────────────────────

export async function embedText(text: string): Promise<Float32Array> {
  const cfg = await resolveEmbeddingConfig();
  if (!cfg || !cfg.embeddingModel || cfg.embeddingModel === "local") return localEmbed(text);

  const span = traceBegin("llm.embed", "llm", { model: cfg.embeddingModel });
  const start = Date.now();
  try {
    const res = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.embeddingModel, input: text }),
    });
    if (!res.ok) {
      log.error({ status: res.status, body: redactText(await res.text()) }, "[llm] embedding failed");
      recordLlm({ model: cfg.embeddingModel, durationMs: Date.now() - start, chars: text.length, error: true });
      return localEmbed(text); // graceful fallback
    }
    const data = await res.json();
    recordLlm({ model: cfg.embeddingModel, durationMs: Date.now() - start, chars: text.length });
    return new Float32Array(data.data[0].embedding);
  } finally {
    traceEnd(span);
  }
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const cfg = await resolveEmbeddingConfig();
  if (!cfg || !cfg.embeddingModel || cfg.embeddingModel === "local") return texts.map((t) => localEmbed(t));

  const span = traceBegin("llm.embed.batch", "llm", { model: cfg.embeddingModel, n: texts.length });
  const start = Date.now();
  try {
    const res = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.embeddingModel, input: texts }),
    });
    if (!res.ok) {
      log.error({ status: res.status }, "[llm] batch embedding failed");
      recordLlm({ model: cfg.embeddingModel, durationMs: Date.now() - start, chars: texts.join("").length, error: true });
      return texts.map((t) => localEmbed(t));
    }
    const data = await res.json();
    recordLlm({ model: cfg.embeddingModel, durationMs: Date.now() - start, chars: texts.join("").length });
    return data.data.map((d: { embedding: number[] }) => new Float32Array(d.embedding));
  } finally {
    traceEnd(span);
  }
}

// ── Chat Completion ─────────────────────────────────────────────────────

interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export async function chatComplete(
  messages: ChatMessage[],
  opts?: ChatOptions
): Promise<string> {
  const cfg = await resolveChatConfig();
  const model = cfg?.chatModel ?? "demo";
  const span = traceBegin("llm.chat", "llm", { model });
  const start = Date.now();
  let error: unknown;
  let usage: LlmUsage | undefined;
  let chars = 0;
  try {
    if (!cfg) return ""; // demo mode (recorded below as a demo call)

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.chatModel,
        messages: wireMessages(messages),
        temperature: opts?.temperature ?? 0.3,
        max_tokens: opts?.maxTokens,
        stream: false,
      }),
    });
    if (!res.ok) {
      log.error({ status: res.status, body: redactText(await res.text()) }, "[llm] chat failed");
      error = new Error(`LLM HTTP ${res.status}`);
      return "";
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    usage = data.usage as LlmUsage | undefined;
    chars = text.length;
    return text;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    recordLlm({
      model,
      durationMs: Date.now() - start,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      chars,
      error: !!error,
    });
    traceEnd(span, error);
  }
}

export async function* chatStream(
  messages: ChatMessage[],
  opts?: ChatOptions
): AsyncGenerator<string> {
  const cfg = await resolveChatConfig();
  const model = cfg?.chatModel ?? "demo";
  const span = traceBegin("llm.chat.stream", "llm", { model });
  const start = Date.now();
  let error: unknown;
  let usage: LlmUsage | undefined;
  let chars = 0;
  try {
    if (!cfg) return;

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.chatModel,
        messages: wireMessages(messages),
        temperature: opts?.temperature ?? 0.3,
        max_tokens: opts?.maxTokens,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      log.error({ status: res.status }, "[llm] chat stream failed");
      error = new Error(`LLM stream HTTP ${res.status}`);
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
          // P6-1: OpenAI sends `usage` in the last chunk before [DONE].
          if (json.usage) usage = json.usage as LlmUsage;
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            chars += (delta as string).length;
            yield delta as string;
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  } catch (err) {
    error = err;
    throw err;
  } finally {
    recordLlm({
      model,
      durationMs: Date.now() - start,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      chars,
      error: !!error,
    });
    traceEnd(span, error);
  }
}

export { cosine };
