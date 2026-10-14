# ---------------------------------------------------------------------------
# 混合检索 - TS src/lib/rag/hybrid-search.ts 的 Python 移植。
# 向量 + BM25 经 Reciprocal Rank Fusion 融合（k=60，权重 0.5/0.5），
# 单侧为空时直接返回另一侧。阶段 1 的 rerank / query-rewrite 为 no-op
# （与 TS 演示模式一致：两者都依赖 LLM Provider）。
# ---------------------------------------------------------------------------
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from .embeddings import embed_one
from .store import AiStore, IndexedChunk, get_store

RRF_K = 60
VECTOR_WEIGHT = 0.5
KEYWORD_WEIGHT = 0.5

ChunkHit = Tuple[IndexedChunk, float]


def _candidate_k(top_k: int) -> int:
    return max(top_k * 3, 15)


def _bm25_to_chunk(workspace_id: str, kb_id: str, chunk, score: float) -> ChunkHit:
    return (
        IndexedChunk(
            workspace_id=workspace_id,
            kb_id=kb_id,
            doc_id=chunk.doc_id,
            doc_name=chunk.doc_name,
            chunk_index=chunk.chunk_index,
            text=chunk.text,
            vector=[],
        ),
        score,
    )


async def hybrid_search(
    workspace_id: str,
    kb_id: str,
    query: str,
    top_k: int,
    store: Optional[AiStore] = None,
) -> List[ChunkHit]:
    st = store or get_store()
    candidate_k = _candidate_k(top_k)

    query_vec = await embed_one(query)
    vector_hits = st.vector_search(workspace_id, kb_id, query_vec, candidate_k)
    bm25_hits = st.bm25_search(workspace_id, kb_id, query, candidate_k)

    if not bm25_hits:
        return vector_hits[:top_k]
    if not vector_hits:
        return [_bm25_to_chunk(workspace_id, kb_id, c, s) for c, s in bm25_hits[:top_k]]

    fused: Dict[str, Tuple[IndexedChunk, float]] = {}
    for rank, (chunk, _cos) in enumerate(vector_hits):
        key = f"{chunk.doc_id}:{chunk.chunk_index}"
        fused[key] = (chunk, VECTOR_WEIGHT * (1.0 / (RRF_K + rank + 1)))
    for rank, (bchunk, _score) in enumerate(bm25_hits):
        key = f"{bchunk.doc_id}:{bchunk.chunk_index}"
        rrf = KEYWORD_WEIGHT * (1.0 / (RRF_K + rank + 1))
        if key in fused:
            existing, s = fused[key]
            fused[key] = (existing, s + rrf)
        else:
            fused[key] = _bm25_to_chunk(workspace_id, kb_id, bchunk, rrf)

    ranked = sorted(fused.values(), key=lambda kv: kv[1], reverse=True)[:top_k]
    return ranked


def chunk_to_payload(chunk: IndexedChunk, score: float) -> Dict:
    return {
        "docId": chunk.doc_id,
        "docName": chunk.doc_name,
        "chunkIndex": chunk.chunk_index,
        "text": chunk.text,
        "score": round(score, 6),
    }
