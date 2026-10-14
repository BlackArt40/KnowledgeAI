# ---------------------------------------------------------------------------
# 生成 - TS src/lib/rag/generator.ts 的 Python 移植。
# 配置 OPENAI_API_KEY：OpenAI 兼容流式生成，输出中的 [n] 标记解析为引用。
# 未配置（演示模式）：抽取式生成 —— 按查询-句子余弦相似度挑选句子，附 [n]
# 引用标记，按 3 字符/token 流式吐出（引用标记保持原子）。
# ---------------------------------------------------------------------------
from __future__ import annotations

import json
import re
from typing import AsyncGenerator, Dict, List, Optional, Tuple

from . import settings
from .embeddings import cosine, embed_one

_SENT_SPLIT_RE = re.compile(r"(?<=[。！？!?])|\n+")
_CITE_RE = re.compile(r"\[(\d+)\]")
_NO_RESULT_TEXT = "未在当前知识库中检索到相关内容。可以尝试换一种问法，或为该知识库上传更多文档。"

ChunkDict = Dict  # {docId, docName, chunkIndex, text, score}
CitationDict = Dict


def _split_sentences(text: str) -> List[str]:
    return [s.strip() for s in _SENT_SPLIT_RE.split(text) if s and len(s.strip()) > 4]


def _citation_for(chunk: ChunkDict, n: int) -> CitationDict:
    cite = {
        "n": n,
        "docId": chunk["docId"],
        "docName": chunk["docName"],
        "chunkIndex": chunk["chunkIndex"],
        "snippet": chunk["text"][:180],
        "score": chunk.get("score", 0),
    }
    if chunk.get("url"):
        cite["url"] = chunk["url"]
    if chunk.get("sourceType"):
        cite["sourceType"] = chunk["sourceType"]
    return cite


def generate_extractive(query: str, chunks: List[ChunkDict]) -> Tuple[str, List[CitationDict]]:
    """抽取式生成（演示模式）- TS generator.ts generate() 的移植（同步封装）。"""
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop is not None:
        # 已在事件循环内：直接走异步版本由调用方使用 generate_stream
        raise RuntimeError("use generate_stream() inside a running loop")
    return asyncio.run(_extractive(query, chunks))


def _parse_citations(text: str, chunks: List[ChunkDict]) -> List[CitationDict]:
    seen = set()
    citations: List[CitationDict] = []
    for m in _CITE_RE.finditer(text):
        n = int(m.group(1))
        if n < 1 or n > len(chunks) or n in seen:
            continue
        seen.add(n)
        citations.append(_citation_for(chunks[n - 1], n))
    return citations


def streamable_tokens(text: str) -> List[str]:
    tokens: List[str] = []
    last = 0
    for m in _CITE_RE.finditer(text):
        before = text[last:m.start()]
        for i in range(0, len(before), 3):
            tokens.append(before[i:i + 3])
        tokens.append(m.group(0))
        last = m.end()
    tail = text[last:]
    for i in range(0, len(tail), 3):
        tokens.append(tail[i:i + 3])
    return tokens


def _build_rag_prompt(
    query: str, chunks: List[ChunkDict], history: Optional[List[Dict]]
) -> List[Dict]:
    sources = "\n\n".join(
        f"[{i + 1}] 《{c['docName']}》（来源：{c['url']}）\n{c['text'][:600]}"
        if c.get("url")
        else f"[{i + 1}] 《{c['docName']}》\n{c['text'][:600]}"
        for i, c in enumerate(chunks)
    )
    if history:
        system = (
            "你是 KnowledgeAI 知识助手。请根据对话历史与以下检索到的来源内容回答用户的最新问题。\n"
            "要求：\n"
            "1. 仅基于提供的来源内容回答，不要编造信息\n"
            "2. 在引用来源处标注 [n]，n 对应来源编号\n"
            "3. 如果来源中没有相关信息，请如实说明并建议换一种问法\n"
            "4. 回答简洁专业，使用中文\n\n"
            f"【来源】\n{sources}"
        )
        messages = [{"role": "system", "content": system}]
        messages.extend(
            {"role": m["role"], "content": m["content"]} for m in history[-6:]
        )
        messages.append({"role": "user", "content": query})
        return messages
    system = (
        "你是 KnowledgeAI 知识助手。请根据以下检索到的来源内容回答用户问题。\n"
        "要求：\n"
        "1. 仅基于提供的来源内容回答，不要编造信息\n"
        "2. 在引用来源处标注 [n]，n 对应来源编号\n"
        "3. 如果来源中没有相关信息，请如实说明并建议换一种问法\n"
        "4. 回答简洁专业，使用中文\n\n"
        f"【来源】\n{sources}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": query},
    ]


class GenerationResult:
    """流式生成的终值持有者（async generator 不支持 return value）。
    text / citations 在生成器耗尽时可用；中途异常时 text 为已产出部分、
    citations 为空（与 TS 侧 error 帧语义一致）。"""

    def __init__(self) -> None:
        self.text = ""
        self.citations: List[CitationDict] = []


async def generate_stream(
    query: str,
    chunks: List[ChunkDict],
    history: Optional[List[Dict]] = None,
    temperature: float = 0.3,
    result: Optional[GenerationResult] = None,
) -> AsyncGenerator[Tuple[str, str], None]:
    """与 TS generateStream 对齐：yield ("token", text)；
    生成结束时把 (full_text, citations) 写入 result。"""
    out = result or GenerationResult()
    if not chunks:
        out.text = _NO_RESULT_TEXT
        yield "token", _NO_RESULT_TEXT
        return

    if settings.llm_enabled():
        text = ""
        try:
            async for delta in _llm_stream(query, chunks, history, temperature):
                text += delta
                yield "token", delta
            if text:
                out.text = text
                out.citations = _parse_citations(text, chunks)
                return
        except Exception:
            if text:
                # 已流出一部分：不再降级重放，直接按已有文本收尾
                out.text = text
                out.citations = _parse_citations(text, chunks)
                return
        # LLM 失败 → 落到抽取式

    extracted_text, citations = await _extractive(query, chunks)
    out.text = extracted_text
    out.citations = citations
    for tok in streamable_tokens(extracted_text):
        yield "token", tok


async def _extractive(query: str, chunks: List[ChunkDict]) -> Tuple[str, List[CitationDict]]:
    qv = await embed_one(query)
    cands: List[Dict] = []
    for rank, c in enumerate(chunks):
        for s in _split_sentences(c["text"]):
            sv = await embed_one(s)
            score = cosine(qv, sv)
            if score > 0.04:
                cands.append(
                    {"sentence": s, "chunk": c, "score": score, "rank": rank}
                )
    cands.sort(key=lambda x: x["score"], reverse=True)
    top = cands[:4]
    if not top:
        c = chunks[0]
        return (
            c["text"][:140],
            [_citation_for(c, 1)],
        )
    top.sort(key=lambda x: x["rank"])
    cite_key: Dict[str, int] = {}
    citations: List[CitationDict] = []
    text = ""
    for item in top:
        c = item["chunk"]
        key = f"{c['docId']}:{c['chunkIndex']}"
        n = cite_key.get(key)
        if not n:
            n = len(citations) + 1
            cite_key[key] = n
            citations.append(_citation_for(c, n))
        text += ((" " if text else "") + item["sentence"] + f"[{n}]")
    return text, citations


async def _llm_stream(
    query: str,
    chunks: List[ChunkDict],
    history: Optional[List[Dict]],
    temperature: float,
) -> AsyncGenerator[str, None]:
    import httpx

    messages = _build_rag_prompt(query, chunks, history)
    async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT_S) as client:
        async with client.stream(
            "POST",
            f"{settings.OPENAI_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
            json={
                "model": settings.CHAT_MODEL,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": 800,
                "stream": True,
            },
        ) as res:
            res.raise_for_status()
            async for line in res.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    data = json.loads(payload)
                except ValueError:
                    continue
                choices = data.get("choices") or []
                if not choices:
                    continue
                delta = (choices[0].get("delta") or {}).get("content")
                if delta:
                    yield delta
