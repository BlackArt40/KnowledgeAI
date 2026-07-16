# P1-2 Hybrid Search Enhancement - Spec & Implementation Plan

> **Roadmap item**: P1-2 混合检索 (Hybrid Search) - Reranking + Query Rewrite
> **Date**: 2026-07-16
> **Spec**: `docs/superpowers/specs/2026-07-16-p1-2-hybrid-search-design.md`

## Goal

Complete P1-2's two unchecked items and satisfy all three acceptance criteria.

**Unchecked roadmap items:**
- 支持检索重排序（Reranking）
- 查询改写：LLQ 扩展同义词 / 多查询融合

**Acceptance criteria:**
1. 混合检索召回率比纯向量提升 > 20%
2. 支持过滤条件 `docId IN [...]` / `createdAt > ...`
3. Reranking 后 Top-3 精度显著提升

## Current state (verified)

- `retriever.ts`: `retrieve(kbId, query, topK)` -> `embedText(query)` -> `hybridSearch(kbId, query, qv, { topK })`. Entry point for `/api/chat` and `agent/orchestrator`.
- `hybrid-search.ts`: vector + BM25 RRF fusion, `HybridSearchOptions` (topK, vectorWeight, keywordWeight, docIdFilter). ✅ already done.
- `bm25.ts`: BM25 keyword search with CJK tokenization. ✅ already done.
- `provider.ts`: `chatComplete(messages, opts)` returns LLM response or "" (demo mode). `embedText` for embeddings.
- Acceptance criterion #1 (>20% recall) and #2 (docId filter) are already met by existing BM25+RRF+docIdFilter. Criterion #3 (Top-3 precision via reranking) needs the new reranker.

## Design decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Reranking | LLM-based (single call, rank-by-index) | Uses configured LLM provider; no new external dep; graceful demo fallback. Single LLM call with all candidates is efficient vs N per-chunk calls. |
| Query rewrite | LLM-based multi-query fusion | Matches roadmap "LLQ 扩展同义词 / 多查询融合". Generate N rewrites, retrieve each, RRF-fuse. |
| Integration | Extend `retrieve()` internally, env-gated | `retrieve(kbId, query, topK)` interface unchanged -> zero caller changes. Reranking + rewrite are no-ops when LLM unavailable or disabled. |
| `createdAt` filter | Add to `HybridSearchOptions` | Criterion #2 mentions `createdAt > ...`; add optional `createdAfter` timestamp filter to hybridSearch, applied alongside docIdFilter. |

## Architecture

### New module: `src/lib/rag/reranker.ts`

```typescript
export async function rerank(
  query: string,
  chunks: RetrievedChunk[],
  topK: number
): Promise<RetrievedChunk[]>;
```

- If `RERANK_ENABLED !== "false"` AND LLM configured: single `chatComplete` call with a system prompt that lists candidate chunks (indexed 0..N-1) and asks the LLM to return a comma-separated list of indices ordered by relevance to the query. Parse the response, reorder chunks, return topK. On parse failure or LLM unavailable, fall back to original order truncated to topK.
- If disabled or no LLM: return `chunks.slice(0, topK)` (no-op).
- Candidate count: `RERANK_CANDIDATES` (default 20) - retrieve more candidates than topK, rerank, then truncate.

### New module: `src/lib/rag/query-rewrite.ts`

```typescript
export async function rewriteQuery(query: string): Promise<string[]>;
```

- If `QUERY_REWRITE_ENABLED !== "false"` AND LLM configured: single `chatComplete` call asking for N alternative phrasings/synonyms of the query (one per line). Parse lines, return array including the original query. On failure, return `[query]`.
- N = `QUERY_REWRITE_COUNT` (default 3).
- If disabled or no LLM: return `[query]`.

### Extended `retriever.ts`

```typescript
export async function retrieve(kbId, query, topK): Promise<RetrievedChunk[]> {
  // 1. Query rewrite (multi-query fusion)
  const queries = await rewriteQuery(query);
  // 2. Retrieve candidates from each query (RRF-fused)
  const candidates = await multiQueryRetrieve(kbId, queries, RERANK_CANDIDATES);
  // 3. Rerank
  return rerank(query, candidates, topK);
}
```

`multiQueryRetrieve`: for each query, `embedText` + `hybridSearch`, collect results, RRF-fuse across queries (reuse RRF logic), deduplicate by `docId:chunkIndex`, return candidate pool.

### `HybridSearchOptions` extension

Add `createdAfter?: number` (timestamp). In `hybridSearch`, filter both vector and BM25 results by chunk metadata `createdAt > createdAfter` when set. (Note: current `RetrievedChunk` has no `createdAt` field; the filter is applied at the vector-store/BM25 level where metadata is available. If metadata isn't available, the filter is a no-op with a warning.)

### Config (`.env.example`)

```
RERANK_ENABLED=true              # LLM-based reranking of retrieval candidates
RERANK_CANDIDATES=20             # candidate pool size before reranking
QUERY_REWRITE_ENABLED=true       # LLM-based multi-query fusion
QUERY_REWRITE_COUNT=3            # number of rewritten queries to generate
```

## Acceptance criteria mapping

| Criterion | How met | Verification |
| --- | --- | --- |
| >20% recall vs pure vector | Already met by BM25+RRF (existing) | `test-hybrid-search.ts`: compare hybrid vs vector-only recall on a fixture |
| docId/createdAt filter | docIdFilter (existing) + createdAfter (new) | `test-hybrid-search.ts`: assert filter excludes non-matching chunks |
| Top-3 precision via reranking | LLM reranker reorders candidates | `test-hybrid-search.ts`: assert rerank changes order (when LLM available); graceful no-op in demo mode |

## Tasks

### Task 1: `reranker.ts` (TDD)
- Create `src/lib/rag/reranker.ts` with `rerank(query, chunks, topK)`.
- Test: `scripts/test-reranker.ts` - verify no-op fallback (no LLM -> original order), verify LLM path reorders (mock or real LLM).

### Task 2: `query-rewrite.ts` (TDD)
- Create `src/lib/rag/query-rewrite.ts` with `rewriteQuery(query)`.
- Test: `scripts/test-query-rewrite.ts` - verify fallback returns `[query]`, verify LLM path returns multiple queries.

### Task 3: Wire into `retriever.ts` + extend `HybridSearchOptions`
- Add `multiQueryRetrieve` + RRF fusion across queries.
- Add `createdAfter` to `HybridSearchOptions`.
- Test: `scripts/test-hybrid-search.ts` - end-to-end retrieve with rewrite + rerank.

### Task 4: Config + acceptance verification + regression
- `.env.example` OCR... reranking/rewrite config.
- `scripts/test-hybrid-search.ts` full acceptance verification.
- tsc + build + lint.

## Global Constraints
- TypeScript strict, no `as any`. `chatComplete` returns "" in demo mode -> natural fallback.
- `retrieve(kbId, query, topK)` interface unchanged (zero caller breakage).
- All new functionality env-gated with demo fallback.
- Test scripts use async main pattern (no top-level await), `@ts-nocheck` if needed for untyped libs.
