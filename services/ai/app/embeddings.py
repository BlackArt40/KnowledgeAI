# ---------------------------------------------------------------------------
# 嵌入：本地哈希嵌入（与 TS 侧 src/lib/llm/embeddings.ts 逐位对齐，演示模式）
#   - 混合分词：拉丁词 + CJK 单字 + CJK 二元组
#   - FNV-1a 32-bit 哈希进 2048 维，L2 归一化，确定性、无 API key
# 配置 OPENAI_API_KEY + EMBEDDING_MODEL 后改走 OpenAI 兼容 /embeddings。
# 注意：索引与查询必须使用同一嵌入模式（进程内单例，不做混用检测）。
# ---------------------------------------------------------------------------
from __future__ import annotations

import math
import re
from typing import List, Optional

DIM = 2048
_FNV_OFFSET = 2166136261
_FNV_PRIME = 16777619
_MASK32 = 0xFFFFFFFF

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def _hash_str(s: str) -> int:
    h = _FNV_OFFSET
    for ch in s:
        h ^= ord(ch)
        h = (h * _FNV_PRIME) & _MASK32
    return h


def tokenize(text: str) -> List[str]:
    t = text.lower()
    out = _TOKEN_RE.findall(t)
    cjk = [ch for ch in t if _CJK_RE.match(ch)]
    out.extend(cjk)
    for i in range(len(cjk) - 1):
        out.append(cjk[i] + cjk[i + 1])
    return out


def _embed_local(text: str) -> List[float]:
    v = [0.0] * DIM
    for tok in tokenize(text):
        v[_hash_str(tok) % DIM] += 1.0
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


async def _embed_remote(texts: List[str]) -> Optional[List[List[float]]]:
    """OpenAI 兼容 /embeddings。失败返回 None（调用方回退本地哈希）。"""
    from . import settings

    if not settings.remote_embedding_enabled():
        return None
    try:
        import httpx

        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT_S) as client:
            res = await client.post(
                f"{settings.OPENAI_BASE_URL}/embeddings",
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                json={"model": settings.EMBEDDING_MODEL, "input": texts},
            )
            res.raise_for_status()
            data = res.json().get("data", [])
            if len(data) != len(texts):
                return None
            return [item["embedding"] for item in data]
    except Exception:
        return None


async def embed_batch(texts: List[str]) -> List[List[float]]:
    remote = await _embed_remote(texts)
    if remote is not None:
        return remote
    return [_embed_local(t) for t in texts]


async def embed_one(text: str) -> List[float]:
    return (await embed_batch([text]))[0]


def cosine(a: List[float], b: List[float]) -> float:
    return sum(x * y for x, y in zip(a, b))
