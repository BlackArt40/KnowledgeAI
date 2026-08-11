// ---------------------------------------------------------------------------
// Metrics (P6-1): in-memory SLI store - request QPS/error-rate/latency,
// RAG / LLM / doc-processing / agent-run dimensions, LLM token + cost by
// model.
//
// Edge-safe (pure globalThis, no Node imports) so `src/proxy.ts` can record
// request-level signals; the per-route status/latency recording itself lives
// in route handlers via `withApiTrace` (middleware cannot observe downstream
// responses in Next 16 - verified against the adapter source).
//
// Ring-buffer caps: latencies 1000, per-minute series 60, errors/traces live
// in their own stores (errors.ts / trace.ts).
// ---------------------------------------------------------------------------

interface LlmModelStat {
  calls: number;
  errors: number;
  tokens: number;
  costUsd: number;
  latencySum: number;
}

interface ObsStore {
  startedAt: number;
  reqTotal: number;
  reqErrors: number;
  perMinute: { ts: number; count: number; errors: number }[];
  latencies: number[];
  rag: { calls: number; errors: number; latencies: number[] };
  llm: {
    calls: number;
    errors: number;
    latencies: number[];
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    byModel: Map<string, LlmModelStat>;
  };
  doc: { calls: number; ok: number; failed: number; durationSum: number };
  agent: { runs: number; ok: number; failed: number; durationSum: number };
}

const LATENCY_CAP = 1000;
const MINUTE_CAP = 60;
const MINUTE_MS = 60_000;

declare global {
  var __KAI_OBS_STORE__: ObsStore | undefined;
}

function store(): ObsStore {
  if (!globalThis.__KAI_OBS_STORE__) {
    globalThis.__KAI_OBS_STORE__ = {
      startedAt: Date.now(),
      reqTotal: 0,
      reqErrors: 0,
      perMinute: [],
      latencies: [],
      rag: { calls: 0, errors: 0, latencies: [] },
      llm: { calls: 0, errors: 0, latencies: [], promptTokens: 0, completionTokens: 0, costUsd: 0, byModel: new Map() },
      doc: { calls: 0, ok: 0, failed: 0, durationSum: 0 },
      agent: { runs: 0, ok: 0, failed: 0, durationSum: 0 },
    };
  }
  return globalThis.__KAI_OBS_STORE__;
}

/** Exact percentile from a sorted numeric array (null when empty). */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function pushLatency(ring: number[], ms: number): void {
  ring.push(ms);
  if (ring.length > LATENCY_CAP) ring.shift();
}

function pushMinute(now: number): void {
  const s = store();
  const slot = Math.floor(now / MINUTE_MS);
  const last = s.perMinute[s.perMinute.length - 1];
  if (last && last.ts === slot) return;
  // Advance, clamped so a long idle gap fills at most MINUTE_CAP slots.
  let ts = Math.max(last ? last.ts + 1 : slot, slot - MINUTE_CAP + 1);
  while (s.perMinute.length > 0 && s.perMinute[0].ts <= slot - MINUTE_CAP) s.perMinute.shift();
  for (; ts <= slot; ts++) {
    s.perMinute.push({ ts, count: 0, errors: 0 });
    if (s.perMinute.length > MINUTE_CAP) s.perMinute.shift();
  }
}

/** Per-request record (status known inside route handlers - see withApiTrace). */
export function recordRequest(status: number, durationMs: number): void {
  const s = store();
  const now = Date.now();
  s.reqTotal++;
  if (status >= 400) s.reqErrors++;
  pushMinute(now);
  const slot = s.perMinute[s.perMinute.length - 1];
  if (slot) {
    slot.count++;
    if (status >= 400) slot.errors++;
  }
  pushLatency(s.latencies, durationMs);
}

/** RAG retrieval (src/lib/rag/retriever.ts). */
export function recordRag(durationMs: number, error: boolean): void {
  const s = store();
  s.rag.calls++;
  if (error) s.rag.errors++;
  pushLatency(s.rag.latencies, durationMs);
}

// ── LLM: tokens + cost ────────────────────────────────────────────────────

/** USD per 1K tokens for known models; unknown models fall back to DEFAULT_COST. */
export const MODEL_COST_1K: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 0.0025, out: 0.01 },
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "gpt-4": { in: 0.03, out: 0.06 },
  "gpt-4-turbo": { in: 0.01, out: 0.03 },
  "gpt-3.5-turbo": { in: 0.0005, out: 0.0015 },
  "deepseek-chat": { in: 0.00027, out: 0.0011 },
  "deepseek-reasoner": { in: 0.00055, out: 0.00219 },
  "moonshot-v1-8k": { in: 0.012, out: 0.012 },
  "moonshot-v1-32k": { in: 0.024, out: 0.024 },
  "glm-4": { in: 0.00014, out: 0.00014 },
  "text-embedding-3-small": { in: 0.00002, out: 0 },
  "text-embedding-3-large": { in: 0.00013, out: 0 },
};

const DEFAULT_COST = { in: 0.002, out: 0.002 };

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const c = MODEL_COST_1K[model] ?? DEFAULT_COST;
  return (promptTokens / 1000) * c.in + (completionTokens / 1000) * c.out;
}

export function recordLlm(input: {
  model: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  chars?: number;
  error?: boolean;
}): void {
  const s = store();
  s.llm.calls++;
  if (input.error) s.llm.errors++;
  pushLatency(s.llm.latencies, input.durationMs);
  // usage is missing in demo mode / non-OpenAI providers: estimate from chars.
  const promptTokens = input.promptTokens ?? Math.max(1, Math.round((input.chars ?? 0) / 4));
  const completionTokens = input.completionTokens ?? 0;
  const costUsd = estimateCostUsd(input.model, promptTokens, completionTokens);
  s.llm.promptTokens += promptTokens;
  s.llm.completionTokens += completionTokens;
  s.llm.costUsd += costUsd;
  const m = s.llm.byModel.get(input.model) ?? { calls: 0, errors: 0, tokens: 0, costUsd: 0, latencySum: 0 };
  m.calls++;
  if (input.error) m.errors++;
  m.tokens += promptTokens + completionTokens;
  m.costUsd += costUsd;
  m.latencySum += input.durationMs;
  s.llm.byModel.set(input.model, m);
}

/** Document processing (parse / index). */
export function recordDoc(durationMs: number, ok: boolean): void {
  const s = store();
  s.doc.calls++;
  if (ok) s.doc.ok++;
  else s.doc.failed++;
  s.doc.durationSum += durationMs;
}

/** Agent research run (runTask). */
export function recordAgent(durationMs: number, ok: boolean): void {
  const s = store();
  s.agent.runs++;
  if (ok) s.agent.ok++;
  else s.agent.failed++;
  s.agent.durationSum += durationMs;
}

function avg(ring: number[]): number | null {
  return ring.length ? ring.reduce((a, b) => a + b, 0) / ring.length : null;
}

function latStat(ring: number[]): { count: number; avgMs: number | null; p50: number | null; p95: number | null; p99: number | null; maxMs: number | null } {
  const sorted = [...ring].sort((a, b) => a - b);
  return {
    count: ring.length,
    avgMs: avg(ring),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

export interface MetricsSnapshot {
  startedAt: number;
  uptimeMs: number;
  requests: {
    total: number;
    errors: number;
    errorRate: number; // percent, 0-100
    perMinute: { ts: number; count: number; errors: number }[];
    latency: ReturnType<typeof latStat>;
  };
  rag: { calls: number; errors: number; latency: ReturnType<typeof latStat> };
  llm: {
    calls: number;
    errors: number;
    latency: ReturnType<typeof latStat>;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    byModel: { model: string; calls: number; errors: number; tokens: number; costUsd: number; avgMs: number | null }[];
  };
  doc: { calls: number; ok: number; failed: number; avgMs: number | null };
  agent: { runs: number; ok: number; failed: number; avgMs: number | null };
}

/** Aggregate snapshot for the admin monitoring dashboard. */
export function getMetricsSnapshot(): MetricsSnapshot {
  const s = store();
  const ragLat = latStat(s.rag.latencies);
  const llmLat = latStat(s.llm.latencies);
  return {
    startedAt: s.startedAt,
    uptimeMs: Date.now() - s.startedAt,
    requests: {
      total: s.reqTotal,
      errors: s.reqErrors,
      errorRate: s.reqTotal > 0 ? (s.reqErrors / s.reqTotal) * 100 : 0,
      perMinute: s.perMinute,
      latency: latStat(s.latencies),
    },
    rag: { calls: s.rag.calls, errors: s.rag.errors, latency: ragLat },
    llm: {
      calls: s.llm.calls,
      errors: s.llm.errors,
      latency: llmLat,
      promptTokens: s.llm.promptTokens,
      completionTokens: s.llm.completionTokens,
      totalTokens: s.llm.promptTokens + s.llm.completionTokens,
      costUsd: s.llm.costUsd,
      byModel: [...s.llm.byModel.entries()]
        .map(([model, m]) => ({
          model,
          calls: m.calls,
          errors: m.errors,
          tokens: m.tokens,
          costUsd: m.costUsd,
          avgMs: m.calls > 0 ? m.latencySum / m.calls : null,
        }))
        .sort((a, b) => b.calls - a.calls),
    },
    doc: { calls: s.doc.calls, ok: s.doc.ok, failed: s.doc.failed, avgMs: s.doc.calls > 0 ? s.doc.durationSum / s.doc.calls : null },
    agent: { runs: s.agent.runs, ok: s.agent.ok, failed: s.agent.failed, avgMs: s.agent.runs > 0 ? s.agent.durationSum / s.agent.runs : null },
  };
}

/** Testing/cleanup hook. */
export function resetMetrics(): void {
  delete globalThis.__KAI_OBS_STORE__;
}
