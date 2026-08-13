// ---------------------------------------------------------------------------
// LLM Provider - OpenAI-compatible chat + embeddings via the Vercel AI SDK
// (`ai` + `@ai-sdk/openai`; replaced the raw fetch/SSE client in 2026-08,
// P7-5). Graceful fallback to local implementations when no provider is
// configured.
//
// Resolution order:
//   1. User-configured model in models store (enabled)  ← runtime config
//   2. Environment variables (OPENAI_API_KEY etc.)       ← deploy-time config
//   3. Local hash embeddings + extractive generation     ← demo mode
// ---------------------------------------------------------------------------

import { generateText, streamText, embed, embedMany, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { embed as localEmbed, cosine } from "@/lib/llm/embeddings";
import { getCurrentUserId } from "@/lib/models/context";
import { recordLlm } from "@/lib/obs/metrics";
import { traceBegin, traceEnd } from "@/lib/obs/trace";
import { log, redactText } from "@/lib/obs/log";
import type { ChatMessage, ChatOptions } from "./types";

// P7-4: map ChatMessage (with optional base64 images) to the AI SDK message
// format - a user message with images becomes a content array of text +
// image parts (vision models only when a real LLM is configured). The SDK
// converts the data-URL to the provider's wire format.
type WirePart = { type: "text"; text: string } | { type: "image"; image: string };

function wireMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((m) => {
    if (m.images && m.images.length > 0) {
      const parts: WirePart[] = [
        { type: "text", text: m.content },
        ...m.images.map((img) => ({
          type: "image" as const,
          image: `data:${img.mime};base64,${img.data}`,
        })),
      ];
      return { role: m.role, content: parts } as ModelMessage;
    }
    return { role: m.role, content: m.content } as ModelMessage;
  });
}

interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  label: string;
}

/** AI SDK OpenAI-compatible provider bound to a resolved config. */
function openai(cfg: ResolvedConfig) {
  return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
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

  const span = beginLlmSpan("llm.embed", cfg.embeddingModel);
  span.ctx.chars = text.length;
  try {
    const { embedding } = await embed({
      model: openai(cfg).embedding(cfg.embeddingModel),
      value: text,
    });
    return new Float32Array(embedding);
  } catch (err) {
    span.ctx.error = err;
    log.error({ err, detail: redactText((err as { responseBody?: string }).responseBody ?? "") }, "[llm] embedding failed");
    return localEmbed(text); // graceful fallback
  } finally {
    span.finish();
  }
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const cfg = await resolveEmbeddingConfig();
  if (!cfg || !cfg.embeddingModel || cfg.embeddingModel === "local") return texts.map((t) => localEmbed(t));

  const span = beginLlmSpan("llm.embed.batch", cfg.embeddingModel, { n: texts.length });
  span.ctx.chars = texts.join("").length;
  try {
    const { embeddings } = await embedMany({
      model: openai(cfg).embedding(cfg.embeddingModel),
      values: texts,
    });
    return embeddings.map((e) => new Float32Array(e));
  } catch (err) {
    span.ctx.error = err;
    log.error({ err, detail: redactText((err as { responseBody?: string }).responseBody ?? "") }, "[llm] batch embedding failed");
    return texts.map((t) => localEmbed(t));
  } finally {
    span.finish();
  }
}

// ── Chat Completion ─────────────────────────────────────────────────────

interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/** HTTP/API errors carry a statusCode on the AI SDK error; network errors don't. */
function isHttpError(err: unknown): err is { statusCode: number } {
  return typeof (err as { statusCode?: unknown })?.statusCode === "number";
}

/**
 * Shared LLM-call lifecycle: trace span + timing + usage/error recording.
 * `ctx` accumulates usage/chars/error during the call; `finish()` records the
 * metric and closes the span exactly once (call it in `finally`). Keeps the
 * sync (chatComplete) and streaming (chatStream) paths from duplicating the
 * same bookkeeping.
 */
interface LlmSpan {
  ctx: { usage: LlmUsage | undefined; chars: number; error: unknown };
  finish: () => void;
}

function beginLlmSpan(spanName: string, model: string, meta: Record<string, unknown> = {}): LlmSpan {
  const span = traceBegin(spanName, "llm", { model, ...meta });
  const start = Date.now();
  const ctx: LlmSpan["ctx"] = { usage: undefined, chars: 0, error: undefined };
  return {
    ctx,
    finish: () => {
      const error = ctx.error;
      recordLlm({
        model,
        durationMs: Date.now() - start,
        promptTokens: ctx.usage?.prompt_tokens,
        completionTokens: ctx.usage?.completion_tokens,
        chars: ctx.chars,
        error: !!error,
      });
      traceEnd(span, error);
    },
  };
}

export async function chatComplete(
  messages: ChatMessage[],
  opts?: ChatOptions
): Promise<string> {
  const cfg = await resolveChatConfig();
  const span = beginLlmSpan("llm.chat", cfg?.chatModel ?? "demo");
  try {
    if (!cfg) return ""; // demo mode (recorded below as a demo call)

    const result = await generateText({
      model: openai(cfg).chat(cfg.chatModel),
      messages: wireMessages(messages),
      temperature: opts?.temperature ?? 0.3,
      maxOutputTokens: opts?.maxTokens,
      // generator.ts passes the system prompt as the first message
      allowSystemInMessages: true,
    });
    const text = result.text;
    span.ctx.usage = {
      prompt_tokens: result.usage?.inputTokens,
      completion_tokens: result.usage?.outputTokens,
    };
    span.ctx.chars = text.length;
    return text;
  } catch (err) {
    span.ctx.error = err;
    if (isHttpError(err)) {
      log.error({ status: err.statusCode, detail: redactText((err as { responseBody?: string }).responseBody ?? "") }, "[llm] chat failed");
      return "";
    }
    throw err;
  } finally {
    span.finish();
  }
}

export async function* chatStream(
  messages: ChatMessage[],
  opts?: ChatOptions
): AsyncGenerator<string> {
  const cfg = await resolveChatConfig();
  const span = beginLlmSpan("llm.chat.stream", cfg?.chatModel ?? "demo");
  try {
    if (!cfg) return;

    const result = streamText({
      model: openai(cfg).chat(cfg.chatModel),
      messages: wireMessages(messages),
      temperature: opts?.temperature ?? 0.3,
      maxOutputTokens: opts?.maxTokens,
      allowSystemInMessages: true,
    });

    // textStream is an async iterable of deltas; usage resolves when the
    // stream finishes.
    for await (const delta of result.textStream) {
      span.ctx.chars += delta.length;
      yield delta;
    }
    const u = await result.usage;
    span.ctx.usage = {
      prompt_tokens: u?.inputTokens,
      completion_tokens: u?.outputTokens,
    };
  } catch (err) {
    span.ctx.error = err;
    if (isHttpError(err)) {
      log.error({ status: err.statusCode, detail: redactText((err as { responseBody?: string }).responseBody ?? "") }, "[llm] chat stream failed");
      return;
    }
    throw err;
  } finally {
    span.finish();
  }
}

export { cosine };
