# ---------------------------------------------------------------------------
# 内存向量/分块存储（演示模式；pgvector 后端属阶段 2/3）。
# 租户契约（service-split.md 不可谈判 #5）：chunk 携带 workspace_id，检索必须
# 同时匹配 workspace_id + kb_id —— 跨租户检索恒为 0 hits，为阶段 3 纵深防御
# 提前落底。
# ---------------------------------------------------------------------------
from __future__ import annotations

import threading
from typing import Dict, List, Optional, Tuple

from .bm25 import BM25Index, StoredChunk as Bm25Chunk
from .embeddings import cosine

from dataclasses import dataclass


@dataclass
class IndexedChunk:
    workspace_id: str
    kb_id: str
    doc_id: str
    doc_name: str
    chunk_index: int
    text: str
    vector: List[float]


def _key(kb_id: str) -> str:
    return kb_id


class AiStore:
    def __init__(self) -> None:
        # RLock：index_chunks 持锁期间会复用 clear_doc（可重入）
        self._lock = threading.RLock()
        self._chunks: Dict[str, List[IndexedChunk]] = {}  # kbId -> chunks
        self._bm25: Dict[str, BM25Index] = {}  # kbId -> index

    # ── 写路径 ────────────────────────────────────────────────────────────

    def index_chunks(
        self,
        workspace_id: str,
        kb_id: str,
        doc_id: str,
        doc_name: str,
        chunks: List[str],
        vectors: List[List[float]],
    ) -> int:
        with self._lock:
            self.clear_doc(kb_id, doc_id)
            bucket = self._chunks.setdefault(_key(kb_id), [])
            for idx, (text, vec) in enumerate(zip(chunks, vectors)):
                bucket.append(
                    IndexedChunk(
                        workspace_id=workspace_id,
                        kb_id=kb_id,
                        doc_id=doc_id,
                        doc_name=doc_name,
                        chunk_index=idx,
                        text=text,
                        vector=vec,
                    )
                )
            self._bm25.setdefault(_key(kb_id), BM25Index()).index_chunks(doc_id, doc_name, chunks)
            return len(chunks)

    def clear_doc(self, kb_id: str, doc_id: str) -> None:
        with self._lock:
            bucket = self._chunks.get(_key(kb_id))
            if bucket:
                self._chunks[_key(kb_id)] = [c for c in bucket if c.doc_id != doc_id]
            idx = self._bm25.get(_key(kb_id))
            if idx:
                idx.clear_doc(doc_id)

    def clear_kb(self, kb_id: str) -> None:
        with self._lock:
            self._chunks.pop(_key(kb_id), None)
            idx = self._bm25.pop(_key(kb_id), None)
            if idx:
                idx.clear()

    # ── 读路径（强制租户过滤）────────────────────────────────────────────

    def vector_search(
        self, workspace_id: str, kb_id: str, query_vec: List[float], top_k: int
    ) -> List[Tuple[IndexedChunk, float]]:
        with self._lock:
            bucket = list(self._chunks.get(_key(kb_id), []))
        # 租户过滤：workspace 与 kb 必须同时匹配（跨租户恒空）
        scoped = [c for c in bucket if c.workspace_id == workspace_id]
        scored = [(c, cosine(query_vec, c.vector)) for c in scoped]
        scored.sort(key=lambda kv: kv[1], reverse=True)
        return scored[:top_k]

    def bm25_search(
        self, workspace_id: str, kb_id: str, query: str, top_k: int
    ) -> List[Tuple[Bm25Chunk, float]]:
        # BM25 索引按 KB 隔离；kbId 归属在 BFF 侧已校验，这里再对 workspace 做
        # chunk 级确认（IndexedChunk 与 BM25 chunk 由同一 index_chunks 写入）。
        with self._lock:
            idx = self._bm25.get(_key(kb_id))
            if not idx:
                return []
            hits = idx.search(query, top_k * 3)
            scoped: List[Tuple[Bm25Chunk, float]] = []
            for chunk, score in hits:
                ws = self._chunk_workspace(kb_id, chunk.doc_id)
                if ws == workspace_id:
                    scoped.append((chunk, score))
            return scoped[:top_k]

    def _chunk_workspace(self, kb_id: str, doc_id: str) -> Optional[str]:
        for c in self._chunks.get(_key(kb_id), []):
            if c.doc_id == doc_id:
                return c.workspace_id
        return None

    def chunk_count(self, kb_id: str) -> int:
        with self._lock:
            return len(self._chunks.get(_key(kb_id), []))

    def total_chunks(self) -> int:
        with self._lock:
            return sum(len(v) for v in self._chunks.values())

    def get_kb_ownership(self, kb_id: str) -> Optional[str]:
        """返回该 KB 当前已索引分块的租户归属（阶段 3 A3.2：index 归属一致性校验）。
        None = 该 KB 尚无任何分块（首写者定归属）。"""
        with self._lock:
            bucket = self._chunks.get(_key(kb_id), [])
            for chunk in bucket:
                return chunk.workspace_id
            return None


_store: Optional[AiStore] = None


def get_store() -> AiStore:
    global _store
    if _store is None:
        _store = AiStore()
    return _store


def reset_store() -> None:
    """仅供测试。"""
    global _store
    _store = AiStore()
