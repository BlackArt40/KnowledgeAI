# ---------------------------------------------------------------------------
# BM25 关键词索引（miniSearch 的 Python 替代，纯标准库实现）。
# 分词与 TS bm25.ts 对齐：拉丁词(2+ 字符) + CJK 单字(含扩展A区) + CJK 二元组。
# 打分用标准 Okapi BM25（k1=1.2, b=0.75）；RRF 融合只依赖相对排序，绝对分值
# 与 miniSearch 的差异可接受（service-split.md 阶段 1 工作包 1.4）。
# ---------------------------------------------------------------------------
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

_TOKEN_RE = re.compile(r"[a-z][a-z0-9]+")
_CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")

K1 = 1.2
B = 0.75


def tokenize(text: str) -> List[str]:
    lower = text.lower()
    tokens = _TOKEN_RE.findall(lower)
    cjk = _CJK_RE.findall(lower)
    tokens.extend(cjk)
    for i in range(len(cjk) - 1):
        tokens.append(cjk[i] + cjk[i + 1])
    return tokens


@dataclass
class StoredChunk:
    doc_id: str
    doc_name: str
    chunk_index: int
    text: str


class BM25Index:
    """单 KB 的内存 BM25 倒排索引。"""

    def __init__(self) -> None:
        self._chunks: Dict[str, StoredChunk] = {}  # chunkId -> chunk
        self._postings: Dict[str, Dict[str, int]] = {}  # term -> {chunkId: tf}
        self._doc_len: Dict[str, int] = {}
        self._doc_chunks: Dict[str, List[str]] = {}  # docId -> [chunkId]
        self._total_len = 0

    def index_chunks(self, doc_id: str, doc_name: str, chunks: List[str]) -> None:
        self.clear_doc(doc_id)
        for idx, text in enumerate(chunks):
            cid = f"{doc_id}::{idx}"
            toks = tokenize(text)
            self._chunks[cid] = StoredChunk(doc_id, doc_name, idx, text)
            self._doc_len[cid] = len(toks)
            self._total_len += len(toks)
            for tok in toks:
                self._postings.setdefault(tok, {}).setdefault(cid, 0)
                self._postings[tok][cid] += 1
            self._doc_chunks.setdefault(doc_id, []).append(cid)

    def clear_doc(self, doc_id: str) -> None:
        for cid in self._doc_chunks.pop(doc_id, []):
            chunk = self._chunks.pop(cid, None)
            self._total_len -= self._doc_len.pop(cid, 0)
            if chunk is None:
                continue
            for tok in tokenize(chunk.text):
                posting = self._postings.get(tok)
                if posting and cid in posting:
                    del posting[cid]
                    if not posting:
                        del self._postings[tok]

    def clear(self) -> None:
        self._chunks.clear()
        self._postings.clear()
        self._doc_len.clear()
        self._doc_chunks.clear()
        self._total_len = 0

    def search(self, query: str, top_k: int) -> List[Tuple[StoredChunk, float]]:
        if not self._chunks:
            return []
        n = len(self._chunks)
        avg_len = (self._total_len / n) or 1.0
        q_tokens = tokenize(query)
        scores: Dict[str, float] = {}
        for tok in q_tokens:
            posting = self._postings.get(tok)
            if not posting:
                continue
            idf = math.log(1.0 + (n - len(posting) + 0.5) / (len(posting) + 0.5))
            for cid, tf in posting.items():
                dl = self._doc_len.get(cid, 0) or 1
                denom = tf + K1 * (1 - B + B * dl / avg_len)
                scores[cid] = scores.get(cid, 0.0) + idf * (tf * (K1 + 1)) / denom
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:top_k]
        return [(self._chunks[cid], s) for cid, s in ranked if cid in self._chunks]
