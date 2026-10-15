# ---------------------------------------------------------------------------
# Agent 四角色调研流水线（阶段 5，手册 5.2）- TS src/lib/agent/orchestrator.ts
# 的 Python 移植。编排采用 LangGraph（ADR-0008：LangGraph 依赖仅允许出现在
# agent 模块，RAG 路径禁止引入）。
#
# 角色与 TS 一致：planner（拆解大纲）→ searcher（KB 检索 + 外源搜索）→
# analyzer（关键洞察）→ writer（报告撰写）。事件帧对齐现网契约：
#   step: {type:"step", step:{role,name,status,progress,detail,result?}}
#   done: {type:"done", task:{...AgentTask JSON（camelCase，与 TS 线上格式一致）}}
# 检索强制 workspace_id + kb_id 双匹配（复用 retrieval.hybrid_search，租户契约）。
# ---------------------------------------------------------------------------
from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from . import external, settings
from .embeddings import cosine, embed_one
from .retrieval import hybrid_search

# ── 模板（TS templates.ts 的移植）───────────────────────────────────────────

TEMPLATES: Dict[str, Dict[str, Any]] = {
    "default": {
        "name": "通用调研",
        "agents": ["planner", "searcher", "analyzer", "writer"],
        "sections": [
            {"id": "background", "title": "背景概述"},
            {"id": "status", "title": "现状分析"},
            {"id": "trends", "title": "核心趋势"},
            {"id": "challenges", "title": "关键挑战"},
            {"id": "outlook", "title": "建议与展望"},
        ],
        "parallelSearch": False,
        "conditionalExpand": False,
    },
    "competitive": {
        "name": "竞品分析",
        "agents": ["planner", "searcher", "analyzer", "writer"],
        "sections": [
            {"id": "overview", "title": "竞品概览"},
            {"id": "features", "title": "功能对比"},
            {"id": "positioning", "title": "定位差异"},
            {"id": "strengths", "title": "优势分析"},
            {"id": "weaknesses", "title": "劣势与风险"},
            {"id": "recommendation", "title": "选型建议"},
        ],
        "parallelSearch": True,
        "conditionalExpand": True,
    },
    "tech-selection": {
        "name": "技术选型",
        "agents": ["planner", "searcher", "analyzer", "writer"],
        "sections": [
            {"id": "context", "title": "技术背景"},
            {"id": "options", "title": "候选方案"},
            {"id": "comparison", "title": "对比分析"},
            {"id": "pros-cons", "title": "优劣势"},
            {"id": "feasibility", "title": "可行性评估"},
            {"id": "decision", "title": "推荐方案"},
        ],
        "parallelSearch": True,
        "conditionalExpand": True,
    },
    "market": {
        "name": "市场洞察",
        "agents": ["planner", "searcher", "analyzer", "writer"],
        "sections": [
            {"id": "size", "title": "市场规模"},
            {"id": "growth", "title": "增长趋势"},
            {"id": "segments", "title": "细分赛道"},
            {"id": "drivers", "title": "驱动因素"},
            {"id": "risks", "title": "风险与挑战"},
            {"id": "opportunity", "title": "机会窗口"},
        ],
        "parallelSearch": True,
        "conditionalExpand": False,
    },
}

AGENT_NAMES = {
    "planner": "规划 Agent",
    "searcher": "检索 Agent",
    "analyzer": "分析 Agent",
    "writer": "写作 Agent",
}


def get_template(template_id: str) -> Dict[str, Any]:
    return TEMPLATES.get(template_id) or TEMPLATES["default"]


# ── 状态 ───────────────────────────────────────────────────────────────────


class AgentState(TypedDict, total=False):
    topic: str
    workspace_id: str
    kb_id: Optional[str]
    kb_name: str
    template_id: str
    output_format: str
    top_k: int
    outline: List[str]
    citations: List[Dict[str, Any]]
    findings: List[Dict[str, Any]]
    section_chunks: Dict[str, List[Dict[str, Any]]]
    external_results: Dict[str, List[Dict[str, Any]]]
    cite_key: Dict[str, int]
    steps: List[Dict[str, Any]]
    parallel_executed: bool
    report: str


EmitFn = Callable[[Dict[str, Any]], Awaitable[None]]


def _now_ms() -> int:
    return int(time.time() * 1000)


async def _animate(step: Dict[str, Any], duration_ms: int) -> None:
    """进度推进（与 TS animateProgress 同形：10 tick）。"""
    ticks = 10
    for i in range(1, ticks + 1):
        await asyncio.sleep(duration_ms / ticks / 1000)
        step["progress"] = round(i / ticks * 100)
    step["endedAt"] = _now_ms()
    step["progress"] = 100


def _source_label(source_type: str, url: str) -> str:
    if source_type == "web":
        return f"🌐 {url}"
    if source_type == "arxiv":
        return f"📄 ArXiv: {url}"
    if source_type == "github":
        return f"🐙 GitHub: {url}"
    return url


# ── 节点 ───────────────────────────────────────────────────────────────────


async def _planner_node(state: AgentState, emit: EmitFn) -> Dict[str, Any]:
    tpl = get_template(state["template_id"])
    step = {"role": "planner", "name": AGENT_NAMES["planner"], "status": "running",
            "progress": 0, "detail": "正在拆解研究主题…", "startedAt": _now_ms()}
    state["steps"].append(step)
    await _animate(step, 800)
    outline = [s["title"] for s in tpl["sections"]]
    step["detail"] = f"已拆解为 {len(outline)} 个研究子方向"
    step["result"] = f"- 研究主题：{state['topic']}\n" + "\n".join(f"- {o}" for o in outline)
    step["status"] = "done"
    await emit({"type": "step", "step": dict(step)})
    return {"outline": outline}


async def _gather_sources(state: AgentState) -> None:
    """KB 检索（租户双过滤）+ 外源搜索；并行模板并发执行。"""
    sections = get_template(state["template_id"])["sections"]
    topic = state["topic"]
    section_chunks: Dict[str, List[Dict[str, Any]]] = {}
    external_results: Dict[str, List[Dict[str, Any]]] = {}

    if state.get("kb_id"):
        kb_id = state["kb_id"]
        workspace_id = state["workspace_id"]
        top_k = state.get("top_k") or 5
        if get_template(state["template_id"])["parallelSearch"]:
            hits = await asyncio.gather(*[
                hybrid_search(workspace_id, kb_id, f"{topic} {s['title']}", top_k)
                for s in sections
            ])
            for s, chunk_hits in zip(sections, hits):
                section_chunks[s["id"]] = [
                    {"docId": c.doc_id, "docName": c.doc_name, "chunkIndex": c.chunk_index,
                     "text": c.text, "score": score}
                    for c, score in chunk_hits
                ]
        else:
            for s in sections:
                chunk_hits = await hybrid_search(workspace_id, kb_id, f"{topic} {s['title']}", top_k)
                section_chunks[s["id"]] = [
                    {"docId": c.doc_id, "docName": c.doc_name, "chunkIndex": c.chunk_index,
                     "text": c.text, "score": score}
                    for c, score in chunk_hits
                ]

    has_kb = bool(state.get("kb_id"))
    # 外源搜索：与 TS 一致——无 KB 时兜底可用；有 KB 时仍并行补充外部视角。
    if external.external_enabled() or not has_kb:
        external_results["global"] = await external.search_external(topic, 4)
        if get_template(state["template_id"])["parallelSearch"]:
            per_section = await asyncio.gather(*[
                external.search_external(f"{topic} {s['title']}", 3) for s in sections
            ])
            for s, results in zip(sections, per_section):
                external_results[s["id"]] = results

    state["section_chunks"] = section_chunks
    state["external_results"] = external_results


def _build_citations(state: AgentState) -> Dict[str, Any]:
    sections = get_template(state["template_id"])["sections"]
    cite_key: Dict[str, int] = state["cite_key"]
    citations: List[Dict[str, Any]] = []
    internal_count = 0
    external_count = 0

    def add(key: str, title: str, source_type: str, label: str, snippet: str, score: float) -> None:
        nonlocal internal_count, external_count
        if key in cite_key:
            return
        n = len(citations) + 1
        cite_key[key] = n
        citations.append({"n": n, "title": title, "source": _source_label(source_type, label),
                          "snippet": snippet[:140], "score": score})
        if source_type == "kb":
            internal_count += 1
        else:
            external_count += 1

    for s in sections:
        for c in (state["section_chunks"].get(s["id"]) or [])[:3]:
            add(f"{c['docId']}:{c['chunkIndex']}", c["docName"], "kb",
                state.get("kb_name") or "知识库", c["text"], c.get("score", 0.0))
        for r in (state["external_results"].get(s["id"]) or [])[:2]:
            add(r["id"], r["title"], r["sourceType"], r["url"], r["snippet"], r.get("score", 0.0))
    for r in (state["external_results"].get("global") or [])[:3]:
        add(r["id"], r["title"], r["sourceType"], r["url"], r["snippet"], r.get("score", 0.0))

    return {"citations": citations, "internal": internal_count, "external": external_count}


_SENT_SPLIT_RE = None  # 延迟编译（与 TS splitSentences 同形）


def _split_sentences(text: str) -> List[str]:
    import re

    parts = re.split(r"(?<=[。！？!?])|\n+", text)
    return [s.strip() for s in parts if s and len(s.strip()) > 8]


async def _searcher_node(state: AgentState, emit: EmitFn) -> Dict[str, Any]:
    step = {"role": "searcher", "name": AGENT_NAMES["searcher"], "status": "running",
            "progress": 0, "detail": "正在检索相关资料…", "startedAt": _now_ms()}
    state["steps"].append(step)
    await _gather_sources(state)
    counts = _build_citations(state)
    state["citations"] = counts["citations"]
    if get_template(state["template_id"])["parallelSearch"]:
        state["parallel_executed"] = True
    await _animate(step, 900)
    step["detail"] = (f"共检索到 {len(counts['citations'])} 条引用来源"
                      f"（内部 {counts['internal']} + 外部 {counts['external']}）")
    step["status"] = "done"
    await emit({"type": "step", "step": dict(step)})
    # parallel 标记随更新返回（LangGraph 节点内的本地赋值不会回写输入 dict）
    return {"citations": state["citations"], "parallel_executed": state.get("parallel_executed", False)}


async def _analyzer_node(state: AgentState, emit: EmitFn) -> Dict[str, Any]:
    step = {"role": "analyzer", "name": AGENT_NAMES["analyzer"], "status": "running",
            "progress": 0, "detail": "正在提炼关键洞察…", "startedAt": _now_ms()}
    state["steps"].append(step)
    await _animate(step, 900)

    sections = get_template(state["template_id"])["sections"]
    topic = state["topic"]
    used = set()
    findings: List[Dict[str, Any]] = []
    for s in sections:
        chunks = state["section_chunks"].get(s["id"]) or []
        qv = await embed_one(f"{topic} {s['title']}")
        cands: List[Dict[str, Any]] = []
        for c in chunks:
            for sent in _split_sentences(c["text"]):
                sv = await embed_one(sent)
                cands.append({"sent": sent, "key": f"{c['docId']}:{c['chunkIndex']}",
                              "score": cosine(qv, sv)})
        cands.sort(key=lambda x: x["score"], reverse=True)
        pick = next((c for c in cands if c["sent"] not in used), cands[0] if cands else None)
        text = ""
        nums: List[int] = []
        if pick:
            used.add(pick["sent"])
            text = pick["sent"]
            n = state["cite_key"].get(pick["key"])
            if n:
                nums = [n]
        else:
            text = f"关于「{s['title']}」，当前知识库资料有限，建议结合更多行业数据深入调研。"
        findings.append({"section": s["title"], "text": text, "nums": nums})

    step["detail"] = f"已提炼 {len(findings)} 条关键洞察"
    step["status"] = "done"
    await emit({"type": "step", "step": dict(step)})
    return {"findings": findings}


async def _writer_node(state: AgentState, emit: EmitFn) -> Dict[str, Any]:
    """报告撰写：LLM 可用时走生成（失败回退），否则确定性模板合成（与 TS 一致）。
    writer 不发独立 step 帧（与 TS orchestrator 的 writer 节点一致）。"""
    del emit  # writer 无进度帧；保留签名与四节点对称
    llm_report = ""
    if settings.llm_enabled():
        llm_report = await _llm_report(state)
    report = llm_report or compose_report(
        state["topic"], state.get("kb_name") or "公开检索",
        state["output_format"], state["findings"], state["citations"])
    return {"report": report}


def _fmt_date() -> str:
    return time.strftime("%Y/%m/%d %H:%M:%S")


def _cite_str(nums: List[int]) -> str:
    return "".join(f"[{n}]" for n in nums) if nums else ""


def compose_report(topic: str, source: str, output_format: str,
                   findings: List[Dict[str, Any]], citations: List[Dict[str, Any]]) -> str:
    """确定性报告合成 - TS composeReport 的逐段移植（演示模式输出形态一致）。"""
    if output_format == "mindmap":
        md = f"# {topic}\n"
        for f in findings:
            md += f"- {f['section']}\n  - {f['text']}{_cite_str(f['nums'])}\n"
        md += "\n- 引用来源\n" + "\n".join(f"  - [{c['n']}] {c['title']}" for c in citations)
        return md

    if output_format == "ppt":
        md = (f"# {topic}\n\n## 幻灯片 1 · 封面\n- {topic}\n- 数据来源：{source}"
              f"\n- 生成于 {_fmt_date()}\n")
        i = 2
        for f in findings:
            md += f"\n## 幻灯片 {i} · {f['section']}\n- {f['text']}{_cite_str(f['nums'])}\n"
            i += 1
        md += (f"\n## 幻灯片 {i} · 总结\n- 以上为基于{source}的自动化调研结果"
               f"\n- 建议结合人工判断进一步核实")
        return md

    md = (f"# {topic} 调研报告\n\n> 数据来源：{source} · 生成于 {_fmt_date()}"
          f" · 由多 Agent 协作完成\n")
    ordinal = ["一", "二", "三", "四", "五", "六"]
    for idx, f in enumerate(findings):
        md += f"\n## {ordinal[idx] if idx < len(ordinal) else idx + 1}、{f['section']}\n\n{f['text']}{_cite_str(f['nums'])}\n"
    md += "\n---\n\n## 引用来源\n\n"
    if not citations:
        md += "本次调研未检索到可引用的来源。\n"
    else:
        for c in citations:
            md += f"[{c['n']}] **{c['title']}** — {c['snippet']}\n\n"
    return md


async def _llm_report(state: AgentState) -> str:
    """LLM 报告（与 TS generateLlmReport 同提示形态）；任何失败返回空串走合成回退。"""
    import httpx

    findings = "\n".join(f"[{i + 1}] {f['section']}：{f['text']}"
                         for i, f in enumerate(state["findings"]))
    sources = "\n".join(f"[{c['n']}] {c['title']}：{c['snippet']}" for c in state["citations"])
    fmt_hint = {"ppt": "PPT 大纲格式（## 幻灯片 N · 标题）",
                "mindmap": "Markdown 思维导图格式（缩进列表）",
                }.get(state["output_format"], "调研报告格式（## 章节）")
    prompt = (
        f"你是 KnowledgeAI 的调研写作 Agent。请根据以下分析结果与引用来源，"
        f"撰写一份关于「{state['topic']}」的{fmt_hint}。\n\n"
        "要求：\n1. 使用中文，专业简洁\n2. 保留来源引用标记 [n]\n3. 使用 Markdown 格式\n\n"
        f"【分析结果】\n{findings}\n\n【引用来源】\n{sources}"
    )
    try:
        async with httpx.AsyncClient(timeout=settings.LLM_TIMEOUT_S) as client:
            res = await client.post(
                f"{settings.OPENAI_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                json={
                    "model": settings.CHAT_MODEL,
                    "messages": [
                        {"role": "system", "content": prompt},
                        {"role": "user",
                         "content": f"请撰写关于「{state['topic']}」的报告。"},
                    ],
                    "temperature": 0.4,
                    "max_tokens": 1500,
                },
            )
        res.raise_for_status()
        return (res.json()["choices"][0]["message"]["content"] or "").strip()
    except Exception:
        return ""


def build_dag(template_id: str, enabled_agents: List[str]) -> tuple:
    """DAG 可视化元数据（与 TS buildDag 同形）。"""
    tpl = get_template(template_id)
    roles = tpl["agents"]
    nodes = [{
        "id": r, "name": AGENT_NAMES.get(r, r), "role": r, "status": "pending",
        "enabled": r in enabled_agents, "indegree": 0 if i == 0 else 1,
    } for i, r in enumerate(roles)]
    edges = [{
        "from": roles[i], "to": roles[i + 1],
        "conditional": bool(tpl["conditionalExpand"]) and roles[i] == "searcher",
    } for i in range(len(roles) - 1)]
    return nodes, edges


# ── LangGraph 组装 ─────────────────────────────────────────────────────────


def _build_graph(emit: EmitFn, order: List[str]):
    """每次执行构建图实例：emit 通过闭包绑定（不进 state channel——
    LangGraph 按 TypedDict 注解建 channel，未注解的键会被丢弃）。
    order = 按模板顺序排列的启用角色子序列（评审 #5：与 TS orchestrator 的
    enabledNodes 语义对齐——未启用的角色不执行；子序列连边保持拓扑通路）。"""

    async def planner(s: AgentState) -> Dict[str, Any]:
        return await _planner_node(s, emit)

    async def searcher(s: AgentState) -> Dict[str, Any]:
        return await _searcher_node(s, emit)

    async def analyzer(s: AgentState) -> Dict[str, Any]:
        return await _analyzer_node(s, emit)

    async def writer(s: AgentState) -> Dict[str, Any]:
        return await _writer_node(s, emit)

    node_fns = {"planner": planner, "searcher": searcher, "analyzer": analyzer, "writer": writer}
    g = StateGraph(AgentState)
    for name in order:
        g.add_node(name, node_fns[name])
    g.add_edge(START, order[0])
    for i in range(len(order) - 1):
        g.add_edge(order[i], order[i + 1])
    g.add_edge(order[-1], END)
    return g.compile()


async def run_pipeline(job: Dict[str, Any], emit: EmitFn) -> Dict[str, Any]:
    """执行四角色流水线，返回完整 AgentTask 快照（camelCase，与 TS 线上格式一致）。"""
    start = _now_ms()
    template_id = job.get("template") or "default"
    tpl = get_template(template_id)
    agents: List[str] = job.get("agents") or tpl["agents"]
    dag_nodes, dag_edges = build_dag(template_id, agents)

    state: AgentState = {
        "topic": job["topic"],
        "workspace_id": job["workspaceId"],
        "kb_id": job.get("kbId"),
        "kb_name": job.get("kbName") or "",
        "template_id": template_id,
        "output_format": job.get("outputFormat") or "report",
        "top_k": 5,
        "outline": [],
        "citations": [],
        "findings": [],
        "section_chunks": {},
        "external_results": {},
        "cite_key": {},
        "steps": [],
        "parallel_executed": False,
        "report": "",
    }
    # 启用节点 = job.agents ∩ 模板角色（按模板顺序取子序列；评审 #5 对齐 TS
    # enabledNodes 语义——未启用角色不执行；非法/空列表回退模板默认）
    enabled = {r for r in (job.get("agents") or tpl["agents"]) if r in tpl["agents"]}
    order = [r for r in tpl["agents"] if r in enabled] or tpl["agents"]
    graph = _build_graph(emit, order)
    try:
        # stream_mode="updates"：每节点完成即产出增量 → 实时发 step 帧
        final: Dict[str, Any] = {}
        async for _node, update in _stream_updates(graph, state):
            final.update(update or {})
        for n in dag_nodes:
            n["status"] = "done" if n["enabled"] else "skipped"
        now = _now_ms()
        # 节点产物从 LangGraph updates 取（节点内对输入 dict 的赋值不回写）；
        # steps 是原地 append 的共享 list，本地引用可见。
        return {
            "id": job["taskId"],
            "topic": state["topic"],
            "kbId": state.get("kb_id"),
            "kbName": state.get("kb_name") or None,
            "workspaceId": state["workspace_id"],
            "outputFormat": state["output_format"],
            "agents": agents,
            "maxSteps": job.get("maxSteps") or 5,
            "status": "done",
            "steps": state["steps"],
            "report": final.get("report", ""),
            "citations": final.get("citations") or [],
            "outline": final.get("outline") or state["outline"],
            "createdAt": job.get("createdAt") or now,
            "updatedAt": now,
            "durationMs": _now_ms() - start,
            "userId": job.get("userId"),
            "template": template_id,
            "dagNodes": dag_nodes,
            "dagEdges": dag_edges,
            "parallelExecuted": bool(final.get("parallel_executed")),
            "branchTriggered": False,
        }
    except Exception as e:
        raise RuntimeError(str(e) or "执行失败") from e


async def _stream_updates(graph, state: AgentState):
    """LangGraph astream(stream_mode='updates') 的解包：yield (node, update)。"""
    async for chunk in graph.astream(dict(state), stream_mode="updates"):
        for node, update in chunk.items():
            if node != "__interrupt__":
                yield node, update
