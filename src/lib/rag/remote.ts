// ---------------------------------------------------------------------------
// AI 服务（Python RAG）远程适配器 —— 阶段 1 绞杀式拆分。
// 见 docs/architecture/service-split.md（阶段 1）与 ADR-0008（框架选型）。
//
// 开关：AI_SERVICE_URL 未设置 = 进程内 TS RAG（单体模式，默认）；
//       设置后文档索引 / 检索 / 问答生成走 Python AI 服务（FastAPI）。
// 降级策略（阶段 1 固定）：Python 不可用 → 检索/问答返回 503 + Retry-After，
// 不静默回退本地 RAG（避免「有时准有时胡编」）；索引失败走队列重试直至死信，
// 文档状态保持 processing/failed。
// 契约：BFF 注入已校验的 workspaceId（Python 不解析用户 JWT）；SSE 帧与现网
// 一致 —— `data: {"type": "sources"|"token"|"done"|"error"}` JSON 行。
// ---------------------------------------------------------------------------

import type { RetrievedChunk, Citation } from "./types";
import type { SourceType } from "@/lib/external/types";
import type { StreamEvent, StreamResult } from "./generator";

export function aiServiceUrl(): string | null {
  const url = process.env.AI_SERVICE_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export function isAiServiceEnabled(): boolean {
  return aiServiceUrl() !== null;
}

export function aiServiceLabel(): string {
  return process.env.AI_SERVICE_URL?.trim() ?? "";
}

function internalHeaders(traceId?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Internal-Token": process.env.AI_INTERNAL_TOKEN ?? "",
  };
  if (traceId) h["X-Trace-Id"] = traceId;
  return h;
}

async function currentTraceId(): Promise<string | undefined> {
  try {
    const { currentTraceCtx } = await import("@/lib/obs/context");
    return currentTraceCtx()?.traceId;
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 解析 AI 服务的 JSON 响应；协议/网络错误统一抛错（调用方转 503 或失败态）。 */
async function postJson<T>(path: string, body: unknown, traceId: string | undefined, timeoutMs: number): Promise<T> {
  const base = aiServiceUrl();
  if (!base) throw new Error("AI_SERVICE_URL not configured");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: internalHeaders(traceId),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!isRecord(data)) throw new Error(`AI service returned non-JSON (${res.status})`);
  return data as T;
}

// ── 索引（doc-process 队列任务调用）──────────────────────────────────────

export interface RemoteIndexPayload {
  workspaceId: string;
  kbId: string;
  docId: string;
  filename: string;
  mime?: string;
  /** content = 内联文本（text-like 文档首选，免对象往返）；
   *  presignedUrl = 短 TTL 预签名 GET（阶段 2 主路径，≤15 分钟）；
   *  s3 = bucket+key（AI 服务用自己的 S3 凭据拉取）。
   *  阶段 1 的 file:// 共享卷协议已随阶段 2 下线（service-split.md 2.3/2.6）。 */
  source:
    | { type: "content"; content: string }
    | { type: "presignedUrl"; url: string }
    | { type: "s3"; bucket?: string; key: string };
  settings: { chunkSize: number; chunkOverlap: number };
}

export interface RemoteIndexResult {
  ok: boolean;
  chunks?: number;
  code?: string;
  message?: string;
}

export async function remoteIndexDocument(payload: RemoteIndexPayload, traceId?: string): Promise<RemoteIndexResult> {
  // 解析/大文件可能较慢：给足超时（队列上下文，不占请求线程）
  return postJson<RemoteIndexResult>("/internal/index", payload, traceId ?? (await currentTraceId()), 120_000);
}

/** 删除文档 / 整库的远端索引（index-cleanup 队列任务调用）。
 *  阶段 3：删除同样强制租户过滤 —— workspaceId 缺失时 Python 返回 400，
 *  与已索引归属不一致返回 403。 */
export async function remoteClearIndex(payload: { workspaceId?: string; kbId: string; docId?: string }, traceId?: string): Promise<void> {
  const base = aiServiceUrl();
  if (!base) throw new Error("AI_SERVICE_URL not configured");
  const wsParam = payload.workspaceId ? `?workspaceId=${encodeURIComponent(payload.workspaceId)}` : "";
  const path = payload.docId ? `/internal/index/${encodeURIComponent(payload.kbId)}/${encodeURIComponent(payload.docId)}` : `/internal/index/${encodeURIComponent(payload.kbId)}`;
  const res = await fetch(`${base}${path}${wsParam}`, {
    method: "DELETE",
    headers: internalHeaders(traceId ?? (await currentTraceId())),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`AI service clear index failed (HTTP ${res.status})`);
}

// ── 检索（chat / 其他调用方）────────────────────────────────────────────

export async function remoteRetrieve(
  workspaceId: string,
  kbId: string,
  query: string,
  topK: number,
  traceId?: string
): Promise<RetrievedChunk[]> {
  const data = await postJson<{ ok: boolean; chunks?: unknown[] }>(
    "/internal/retrieve",
    { workspaceId, kbId, query, topK },
    traceId ?? (await currentTraceId()),
    30_000
  );
  if (!data.ok || !Array.isArray(data.chunks)) throw new Error("AI service retrieve failed");
  return data.chunks.filter(isRecord).map((c) => ({
    docId: String(c.docId ?? ""),
    docName: String(c.docName ?? ""),
    chunkIndex: Number(c.chunkIndex ?? 0),
    text: String(c.text ?? ""),
    score: Number(c.score ?? 0),
    ...(typeof c.url === "string" && c.url ? { url: c.url } : {}),
    ...(typeof c.sourceType === "string" && c.sourceType ? { sourceType: c.sourceType as SourceType } : {}),
  }));
}

// ── 流式生成（SSE 透传）────────────────────────────────────────────────

export interface RemoteChatOptions {
  workspaceId: string;
  kbId: string;
  conversationId?: string;
  query: string;
  /** BFF 已过滤（GraphRAG/降权/私档/联网合并）的检索结果 —— 权威上下文。 */
  chunks: RetrievedChunk[];
  history?: { role: "user" | "assistant"; content: string }[];
  temperature?: number;
  /** M-10：客户端断开时取消底层 fetch。 */
  signal?: AbortSignal;
}

/**
 * 与 generateStream() 同构：yield {type:"token", text}，
 * 结束时返回 {text, citations}。Python 的 sources 帧被跳过 —— BFF 已用
 * 本地 chunks（远端 retrieve 的结果 + 过滤）先行发送 sources 事件。
 */
export async function* remoteGenerateStream(
  opts: RemoteChatOptions
): AsyncGenerator<StreamEvent, StreamResult> {
  const base = aiServiceUrl();
  if (!base) throw new Error("AI_SERVICE_URL not configured");
  const res = await fetch(`${base}/internal/chat/stream`, {
    method: "POST",
    headers: internalHeaders(await currentTraceId()),
    body: JSON.stringify({
      workspaceId: opts.workspaceId,
      kbId: opts.kbId,
      conversationId: opts.conversationId ?? "",
      query: opts.query,
      chunks: opts.chunks,
      history: opts.history ?? [],
      temperature: opts.temperature ?? 0.3,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`AI service chat stream failed (HTTP ${res.status})`);

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      let frame: unknown;
      try {
        frame = JSON.parse(line.slice(5).trim());
      } catch {
        continue; // 忽略残帧
      }
      if (!isRecord(frame)) continue;
      if (frame.type === "token" && typeof frame.text === "string" && frame.text) {
        yield { type: "token", text: frame.text };
      } else if (frame.type === "done") {
        const citations = Array.isArray(frame.citations)
          ? frame.citations.filter(isRecord).map((c) => ({
              n: Number(c.n ?? 0),
              docId: String(c.docId ?? ""),
              docName: String(c.docName ?? ""),
              chunkIndex: Number(c.chunkIndex ?? 0),
              snippet: String(c.snippet ?? ""),
              score: Number(c.score ?? 0),
              ...(typeof c.url === "string" && c.url ? { url: c.url } : {}),
              ...(typeof c.sourceType === "string" && c.sourceType ? { sourceType: c.sourceType } : {}),
            }))
          : [];
        return { text: typeof frame.text === "string" ? frame.text : "", citations: citations as Citation[] };
      } else if (frame.type === "error") {
        throw new Error(typeof frame.message === "string" ? frame.message : "AI service generation error");
      }
      // sources 帧：BFF 已发送，跳过
    }
  }
  throw new Error("AI service stream ended without done frame");
}
