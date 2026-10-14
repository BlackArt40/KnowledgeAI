# ---------------------------------------------------------------------------
# 外源搜索 - TS src/lib/external/provider.ts 的 Python 移植（阶段 5，5.2）。
# env 门控真实实现 + 演示回退（与 TS 一致）：
#   TAVILY_API_KEY / SERPAPI_API_KEY / BRAVE_API_KEY / GITHUB_TOKEN
#   ARXIV 检索走公开 API（无需凭据，默认开启）
# 统一结果结构 ExternalResult 对齐 TS：{id, sourceType, title, url, snippet, score}。
#
# SSRF 基线（A5.4，fail-closed 与现网 src/lib/security/ssrf.ts 同语义）：
# 任何对外源 URL 的抓取（deep crawl 等）必须先过 assert_public_url —— 回环/
# 私网/链路本地/云元数据地址一律拒绝；仅 AI_ALLOW_PRIVATE_FETCH=true 可放开。
# ---------------------------------------------------------------------------
from __future__ import annotations

import re
from typing import Dict, List
from urllib.parse import urlparse, quote

import httpx

from . import settings

_BAD_HOST_PREFIXES = (
    "127.", "10.", "192.168.", "169.254.",
    "172.16.", "172.17.", "172.18.", "172.19.",
    "172.20.", "172.21.", "172.22.", "172.23.",
    "172.24.", "172.25.", "172.26.", "172.27.",
    "172.28.", "172.29.", "172.30.", "172.31.",
)


class SourceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def is_public_url(url: str) -> bool:
    """SSRF 判定：http(s)、主机非回环/私网/链路本地/云元数据（fail-closed）。"""
    try:
        parts = urlparse(url)
    except ValueError:
        return False
    if parts.scheme not in ("http", "https"):
        return False
    host = (parts.hostname or "").lower()
    if host in ("localhost", "0.0.0.0", "::1", "") or host.endswith(".local"):
        return False
    if host == "metadata.google.internal" or host.endswith(".internal"):
        return False
    if host.startswith(_BAD_HOST_PREFIXES):
        return False
    # IPv6 字面量里的回环/链路本地
    if host.startswith("["):
        inner = host.strip("[]").lower()
        if inner in ("::1", "::") or inner.startswith("fe80") or inner.startswith("fc") or inner.startswith("fd"):
            return False
    return True


def assert_public_url(url: str) -> None:
    """外源抓取闸门（A5.4）：恒定 fail-closed，无环境旁路——比 KB 源抓取的
    _assert_public_http（AI_ALLOW_PRIVATE_FETCH 可放行内网 MinIO）更严格。
    外源搜索结果里的 URL 来自第三方 API 响应，不可信，一律拒绝内网/元数据。"""
    if not is_public_url(url):
        raise SourceError("forbidden_source", "目标地址被禁止（内网/回环/元数据）")


def _source_config() -> Dict[str, bool]:
    return {
        "web": bool(settings.TAVILY_API_KEY or settings.SERPAPI_KEY or settings.BRAVE_SEARCH_KEY),
        "arxiv": True,  # 公开 API，始终可用（与 TS cfg.arxiv 对齐）
        "github": bool(settings.GITHUB_TOKEN),
    }


def external_enabled() -> bool:
    cfg = _source_config()
    return cfg["web"] or cfg["arxiv"] or cfg["github"]


def _quality_score(base: float, url: str) -> float:
    # 与 TS qualityScore 同形：域名可信度微调，clamp 0-1
    score = max(0.0, min(1.0, base))
    if ".gov" in url or ".edu" in url:
        score = min(1.0, score + 0.1)
    return round(score, 4)


def demo_web_results(query: str, max_results: int) -> List[Dict]:
    """演示回退 - TS demoWebResults 的移植（无 key 时返回确定性合成结果）。"""
    topics = [
        ("概述与背景", f"关于「{query}」的综合概述，涵盖定义、发展历程和核心概念。"),
        ("最新趋势分析", f"「{query}」领域的最新发展趋势和未来方向预测。"),
        ("技术细节与实现", f"「{query}」的关键技术原理和工程实践指南。"),
        ("行业应用案例", f"「{query}」在不同行业的实际落地案例和效果评估。"),
    ]
    return [
        {
            "id": f"web:demo-{i}",
            "sourceType": "web",
            "title": f"{query} - {label}",
            "url": f"https://example.com/{quote(query)}/{i}",
            "snippet": snippet,
            "score": _quality_score(0.5, f"https://example.com/{i}"),
        }
        for i, (label, snippet) in enumerate(topics[:max_results])
    ]


async def _web_search(query: str, max_results: int) -> List[Dict]:
    results: List[Dict] = []
    async with httpx.AsyncClient(timeout=15.0) as client:
        if settings.TAVILY_API_KEY:
            res = await client.post(
                "https://api.tavily.com/search",
                json={"api_key": settings.TAVILY_API_KEY, "query": query,
                      "max_results": max_results, "include_raw_content": False},
            )
            if res.status_code == 200:
                for r in res.json().get("results", [])[:max_results]:
                    results.append({
                        "id": f"web:{r['url']}", "sourceType": "web",
                        "title": r.get("title", ""), "url": r.get("url", ""),
                        "snippet": (r.get("content") or "")[:300],
                        "score": _quality_score(float(r.get("score") or 0.5), r.get("url", "")),
                    })
        elif settings.SERPAPI_KEY:
            res = await client.get(
                "https://serpapi.com/search.json",
                params={"api_key": settings.SERPAPI_KEY, "q": query, "num": max_results},
            )
            if res.status_code == 200:
                for r in res.json().get("organic_results", [])[:max_results]:
                    results.append({
                        "id": f"web:{r.get('link', '')}", "sourceType": "web",
                        "title": r.get("title", ""), "url": r.get("link", ""),
                        "snippet": (r.get("snippet") or "")[:300],
                        "score": _quality_score(0.6, r.get("link", "")),
                    })
        elif settings.BRAVE_SEARCH_KEY:
            res = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                headers={"X-Subscription-Token": settings.BRAVE_SEARCH_KEY},
                params={"q": query, "count": max_results},
            )
            if res.status_code == 200:
                for r in res.json().get("web", {}).get("results", [])[:max_results]:
                    results.append({
                        "id": f"web:{r.get('url', '')}", "sourceType": "web",
                        "title": r.get("title", ""), "url": r.get("url", ""),
                        "snippet": (r.get("description") or "")[:300],
                        "score": _quality_score(0.6, r.get("url", "")),
                    })
    return results


_ARXIV_ID_RE = re.compile(r"^arxiv:\d{4}\.\d{4,5}v\d+$")


async def _arxiv_search(query: str, max_results: int) -> List[Dict]:
    q = quote(query.replace(" ", "+"))
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            res = await client.get(
                f"https://export.arxiv.org/api/query?search_query=all:{q}"
                f"&max_results={max_results}&sortBy=relevance"
            )
        if res.status_code != 200:
            return []
    except Exception:
        return []
    entries: List[Dict] = []
    # 极简 Atom 解析（条目数固定很小，避免引入 XML 依赖）
    for m in re.finditer(r"<entry>(.*?)</entry>", res.text, re.S):
        block = m.group(1)
        title = re.search(r"<title>(.*?)</title>", block, re.S)
        link = re.search(r"<id>(.*?)</id>", block, re.S)
        summary = re.search(r"<summary>(.*?)</summary>", block, re.S)
        url = (link.group(1).strip() if link else "").strip()
        entries.append({
            "id": f"arxiv:{url.rsplit('/', 1)[-1]}",
            "sourceType": "arxiv",
            "title": re.sub(r"\s+", " ", title.group(1)).strip() if title else "",
            "url": url,
            "snippet": re.sub(r"\s+", " ", summary.group(1)).strip()[:300] if summary else "",
            "score": _quality_score(0.7, url),
        })
    return entries[:max_results]


async def _github_search(query: str, max_results: int) -> List[Dict]:
    headers = {"Accept": "application/vnd.github+json"}
    if settings.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {settings.GITHUB_TOKEN}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(
                "https://api.github.com/search/repositories",
                headers=headers,
                params={"q": query, "per_page": max_results},
            )
        if res.status_code != 200:
            return []
    except Exception:
        return []
    return [
        {
            "id": f"github:{item['html_url']}", "sourceType": "github",
            "title": item.get("full_name", ""), "url": item.get("html_url", ""),
            "snippet": (item.get("description") or "")[:300],
            "score": _quality_score(0.6, item.get("html_url", "")),
        }
        for item in res.json().get("items", [])[:max_results]
    ]


def _dedupe(results: List[Dict]) -> List[Dict]:
    seen: Dict[str, Dict] = {}
    for r in results:
        key = re.sub(r"[#?].*$", "", (r.get("url") or "").lower())
        existing = seen.get(key)
        if existing is None or r.get("score", 0) > existing.get("score", 0):
            seen[key] = r
    return list(seen.values())


async def search_external(query: str, max_per_source: int = 5) -> List[Dict]:
    """统一搜索：聚合启用源 → 去重。无可用源时返回演示结果（与 TS 一致）。"""
    cfg = _source_config()
    all_results: List[Dict] = []
    if cfg["web"]:
        all_results.extend(await _web_search(query, max_per_source))
    if cfg["arxiv"]:
        all_results.extend(await _arxiv_search(query, max_per_source))
    if cfg["github"]:
        all_results.extend(await _github_search(query, max_per_source))
    if not all_results:
        all_results.extend(demo_web_results(query, max_per_source))
    return _dedupe(all_results)
