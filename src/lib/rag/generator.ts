import { embed, cosine } from "./embeddings";
import { chatComplete, chatStream, isLLMEnabled } from "@/lib/llm/provider";
import type { RetrievedChunk, Citation, GenerationResult } from "./types";

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
      citations: [{ n: 1, docId: c.docId, docName: c.docName, chunkIndex: c.chunkIndex, snippet: c.text.slice(0, 180), score: c.score }],
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
      });
    }
    text += (text ? " " : "") + s.sentence + `[${n}]`;
  }
  return { text, citations };
}

// ── LLM RAG prompt builder ───────────────────────────────────────────────

function buildRagPrompt(query: string, chunks: RetrievedChunk[]) {
  const sources = chunks
    .map((c, i) => `[${i + 1}] 《${c.docName}》\n${c.text.slice(0, 600)}`)
    .join("\n\n");

  const system = `你是 KnowledgeAI 知识助手。请根据以下检索到的知识库内容回答用户问题。
要求：
1. 仅基于提供的来源内容回答，不要编造信息
2. 在引用来源处标注 [n]，n 对应来源编号
3. 如果来源中没有相关信息，请如实说明并建议换一种问法
4. 回答简洁专业，使用中文

【来源】
${sources}`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: query },
  ];
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
    });
  }
  return citations;
}

// ── Async generation (LLM or extractive fallback) ────────────────────────

export async function generateAsync(
  query: string,
  chunks: RetrievedChunk[]
): Promise<GenerationResult> {
  if (chunks.length === 0) {
    return {
      text: "未在当前知识库中检索到相关内容。可以尝试换一种问法，或为该知识库上传更多文档。",
      citations: [],
    };
  }

  if (isLLMEnabled()) {
    const messages = buildRagPrompt(query, chunks);
    const text = await chatComplete(messages, { temperature: 0.3, maxTokens: 800 });
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
  chunks: RetrievedChunk[]
): AsyncGenerator<StreamEvent, StreamResult> {
  if (chunks.length === 0) {
    const text = "未在当前知识库中检索到相关内容。可以尝试换一种问法，或为该知识库上传更多文档。";
    yield { type: "token", text };
    return { text, citations: [] };
  }

  if (isLLMEnabled()) {
    const messages = buildRagPrompt(query, chunks);
    let full = "";
    for await (const delta of chatStream(messages, { temperature: 0.3, maxTokens: 800 })) {
      full += delta;
      yield { type: "token", text: delta };
    }
    return { text: full, citations: parseCitations(full, chunks) };
  }

  // Extractive fallback: generate full text, then stream in chunks
  const result = generate(query, chunks);
  const tokens = streamableTokens(result.text);
  for (const tok of tokens) {
    yield { type: "token", text: tok };
  }
  return { text: result.text, citations: result.citations };
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
