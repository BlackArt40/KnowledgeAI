import { embed, cosine } from "@/lib/llm/embeddings";
import { chatComplete, chatStream, isLLMEnabled } from "@/lib/llm/provider";
import type { ChatImage, ChatMessage as LlmChatMessage } from "@/lib/llm/types";
import { recordLlm } from "@/lib/obs/metrics";
import { traceBegin, traceEnd } from "@/lib/obs/trace";
import type { RetrievedChunk, Citation, GenerationResult } from "./types";
import type { ChatMessage } from "./conversation-context";
import { buildContextualSystemPrompt } from "./conversation-context";

// ---------------------------------------------------------------------------
// Generator — composes an answer from retrieved chunks.
//
// When LLM is configured (OPENAI_API_KEY): true abstractive generation via
//   OpenAI streaming, with inline [n] citation markers parsed from output.
// Otherwise: extractive generation (picks most relevant sentences + citations).
// ---------------------------------------------------------------------------

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4);
}

// ── Extractive fallback (demo mode) ──────────────────────────────────────

export function generate(query: string, chunks: RetrievedChunk[]): GenerationResult {
  if (chunks.length === 0) {
    return {
      text: "未在当前知识库中检索到相关内容。可以尝试换一种问法，或为该知识库上传更多文档。",
      citations: [],
    };
  }

  const qv = embed(query);
  type Cand = {
    sentence: string;
    docId: string;
    docName: string;
    chunkIndex: number;
    score: number;
    rank: number;
  };
  const cands: Cand[] = [];
  chunks.forEach((c, rank) => {
    for (const s of splitSentences(c.text)) {
      const score = cosine(qv, embed(s));
      if (score > 0.04) cands.push({ sentence: s, docId: c.docId, docName: c.docName, chunkIndex: c.chunkIndex, score, rank });
    }
  });

  cands.sort((a, b) => b.score - a.score);
  const top = cands.slice(0, 4);
  if (top.length === 0) {
    const c = chunks[0];
    const snippet = c.text.slice(0, 140);
    return {
      text: snippet,
      citations: [{ n: 1, docId: c.docId, docName: c.docName, chunkIndex: c.chunkIndex, snippet: c.text.slice(0, 180), score: c.score, ...(c.url ? { url: c.url } : {}), ...(c.sourceType ? { sourceType: c.sourceType } : {}) }],
    };
  }

  top.sort((a, b) => a.rank - b.rank);

  const citeKey = new Map<string, number>();
  const citations: Citation[] = [];
  let text = "";
  for (const s of top) {
    const key = `${s.docId}:${s.chunkIndex}`;
    let n = citeKey.get(key);
    if (!n) {
      n = citations.length + 1;
      citeKey.set(key, n);
      const chunk = chunks.find((c) => c.docId === s.docId && c.chunkIndex === s.chunkIndex)!;
      citations.push({
        n,
        docId: s.docId,
        docName: s.docName,
        chunkIndex: s.chunkIndex,
        snippet: chunk.text.slice(0, 180),
        score: chunk.score,
        ...(chunk.url ? { url: chunk.url } : {}),
        ...(chunk.sourceType ? { sourceType: chunk.sourceType } : {}),
      });
    }
    text += (text ? " " : "") + s.sentence + `[${n}]`;
  }
  return { text, citations };
}

// ── LLM RAG prompt builder ───────────────────────────────────────────────

function buildRagPrompt(query: string, chunks: RetrievedChunk[], history?: ChatMessage[], images?: ChatImage[]): LlmChatMessage[] {
  const sources = chunks
    .map((c, i) => `[${i + 1}] 《${c.docName}》${c.url ? `（来源：${c.url}）` : ""}\n${c.text.slice(0, 600)}`)
    .join("\n\n");


  // Use contextual prompt (with history + intent) when history is provided
  let messages: LlmChatMessage[];
  if (history && history.length > 0) {
    messages = buildContextualSystemPrompt(query, history, sources) as ChatMessage[];
  } else {
    const system = `你是 KnowledgeAI 知识助手。请根据以下检索到的来源内容回答用户问题。
要求：
1. 仅基于提供的来源内容回答，不要编造信息
2. 在引用来源处标注 [n]，n 对应来源编号
3. 如果来源中没有相关信息，请如实说明并建议换一种问法
4. 回答简洁专业，使用中文

【来源】
${sources}`;
    messages = [
      { role: "system" as const, content: system },
      { role: "user" as const, content: query },
    ];
  }
  // P7-4: attach uploaded images to the LAST user message (the current query).
  if (images && images.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        messages[i] = { ...messages[i], images };
        break;
      }
    }
  }
  return messages;
}

// Parse [n] markers from LLM output → build citations list.
function parseCitations(text: string, chunks: RetrievedChunk[]): Citation[] {
  const seen = new Set<number>();
  const citations: Citation[] = [];
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = parseInt(m[1], 10);
    if (n < 1 || n > chunks.length || seen.has(n)) continue;
    seen.add(n);
    const c = chunks[n - 1];
    citations.push({
      n,
      docId: c.docId,
      docName: c.docName,
      chunkIndex: c.chunkIndex,
      snippet: c.text.slice(0, 180),
      score: c.score,
      ...(c.url ? { url: c.url } : {}),
      ...(c.sourceType ? { sourceType: c.sourceType } : {}),
    });
  }
  return citations;
}

// ── Async generation (LLM or extractive fallback) ────────────────────────

export async function generateAsync(
  query: string,
  chunks: RetrievedChunk[],
  history?: ChatMessage[],
  temperature = 0.3,
  images?: ChatImage[]
): Promise<GenerationResult> {
  if (chunks.length === 0) {
    return {
      text: "未在当前知识库中检索到相关内容。可以尝试换一种问法，或为该知识库上传更多文档。",
      citations: [],
    };
  }

  if (await isLLMEnabled()) {
    const messages = buildRagPrompt(query, chunks, history, images);
    const text = await chatComplete(messages, { temperature, maxTokens: 800 });
    if (text) {
      return { text, citations: parseCitations(text, chunks) };
    }
    // fallback if LLM call failed
  }

  return generate(query, chunks);
}

export interface StreamEvent {
  type: "token" | "sources";
  text?: string;
  count?: number;
}

export interface StreamResult {
  citations: Citation[];
  text: string;
}

/**
 * Stream-generate an answer. Yields { type: "token", text } events.
 * When LLM is configured, streams directly from OpenAI.
 * Returns final { text, citations } after streaming completes.
 *
 * Usage:
 *   for await (const ev of generateStream(query, chunks)) { ... }
 *   // ev.type === "token" → emit delta to client
 */
export async function* generateStream(
  query: string,
  chunks: RetrievedChunk[],
  history?: ChatMessage[],
  temperature = 0.3,
  images?: ChatImage[],
  /** M-10: client-disconnect abort signal - forwarded to the LLM stream so a
   *  dropped SSE connection cancels the underlying fetch (no token burn). */
  signal?: AbortSignal
): AsyncGenerator<StreamEvent, StreamResult> {
  if (chunks.length === 0) {
    const text = "未在当前知识库中检索到相关内容。可以尝试换一种问法，或为该知识库上传更多文档。";
    yield { type: "token", text };
    return { text, citations: [] };
  }

  if (await isLLMEnabled()) {
    const messages = buildRagPrompt(query, chunks, history, images);
    let full = "";
    for await (const delta of chatStream(messages, { temperature, maxTokens: 800, signal })) {
      full += delta;
      yield { type: "token", text: delta };
    }
    return { text: full, citations: parseCitations(full, chunks) };
  }

  // Extractive fallback: generate full text, then stream in chunks.
  // P6-1: recorded as an llm-kind stage (model "demo") so the trace chain
  // api -> rag -> llm holds in demo mode too, and the LLM dashboard shows
  // generation activity without a configured provider.
  const genStart = Date.now();
  const genSpan = traceBegin("llm.generate", "llm", { model: "demo", mode: "extractive" });
  let genResult: GenerationResult | undefined;
  try {
    genResult = generate(query, chunks);
    const tokens = streamableTokens(genResult.text);
    for (const tok of tokens) {
      yield { type: "token", text: tok };
    }
    return { text: genResult.text, citations: genResult.citations };
  } finally {
    recordLlm({ model: "demo", durationMs: Date.now() - genStart, chars: genResult?.text?.length ?? 0 });
    traceEnd(genSpan);
  }
}

// Split text into streamable tokens: citation markers stay atomic.
function streamableTokens(text: string): string[] {
  const tokens: string[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(last, m.index);
    for (let i = 0; i < before.length; i += 3) tokens.push(before.slice(i, i + 3));
    tokens.push(m[0]);
    last = m.index + m[0].length;
  }
  const after = text.slice(last);
  for (let i = 0; i < after.length; i += 3) tokens.push(after.slice(i, i + 3));
  return tokens;
}
