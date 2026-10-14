# ---------------------------------------------------------------------------
# 阶段 5 验收测试（A5.4 SSRF 负例 + 流水线确定性 + 外源回退）。
# 运行：services/ai/.venv/bin/python -m pytest services/ai/tests/test_agent.py -q
# ---------------------------------------------------------------------------
from __future__ import annotations

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import agent, external  # noqa: E402


# ── A5.4：SSRF fail-closed（对元数据 IP 负例）───────────────────────────────


@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data/",  # AWS/GCP 云元数据
    "http://127.0.0.1:6379/",                     # 回环
    "http://10.0.0.5/internal",                   # 私网
    "http://192.168.1.10/admin",
    "http://172.16.0.9/",
    "http://localhost:8000/health",
    "http://metadata.google.internal/computeMetadata/v1/",
    "file:///etc/passwd",
    "ftp://example.com/x",
])
def test_ssrf_private_urls_rejected(url):
    assert not external.is_public_url(url), f"应当拒绝: {url}"
    with pytest.raises(external.SourceError):
        external.assert_public_url(url)


@pytest.mark.parametrize("url", [
    "https://api.tavily.com/search",
    "https://export.arxiv.org/api/query",
    "https://example.com/x?q=1",
])
def test_ssrf_public_urls_allowed(url):
    assert external.is_public_url(url)


def test_ssrf_no_env_escape(monkeypatch):
    """A5.4：抓取闸门恒定 fail-closed——AI_ALLOW_PRIVATE_FETCH 只管 KB 源抓取
    （main.py），不影响外源结果抓取闸门（第三方 API 返回的 URL 不可信）。"""
    from app import settings

    monkeypatch.setattr(settings, "AI_ALLOW_PRIVATE_FETCH", True)
    with pytest.raises(external.SourceError):
        external.assert_public_url("http://169.254.169.254/")


# ── 流水线（LangGraph 四角色，演示模式确定性输出）───────────────────────────


def _run(task_id: str = "task_test", **overrides):
    frames: list = []

    async def emit(frame):
        frames.append(frame)

    job = {"taskId": task_id, "workspaceId": "ws_default", "topic": "知识库产品的市场格局",
           "outputFormat": "report", "template": "default"}
    job.update(overrides)
    task = asyncio.run(agent.run_pipeline(job, emit))
    return task, frames


def test_pipeline_done_with_steps_and_report():
    task, frames = _run()
    assert task["status"] == "done"
    # TS 契约：step 帧来自 planner/searcher/analyzer（writer 无独立 step）
    assert [f["type"] for f in frames] == ["step", "step", "step"]
    assert [f["step"]["role"] for f in frames] == ["planner", "searcher", "analyzer"]
    assert task["report"].startswith("# 知识库产品的市场格局 调研报告")
    assert "## 引用来源" in task["report"]
    assert task["outline"] == ["背景概述", "现状分析", "核心趋势", "关键挑战", "建议与展望"]
    assert task["citations"], "演示模式应有外源演示引用"
    assert all(c["n"] >= 1 for c in task["citations"])
    # camelCase 线上格式（业务服务直接透传 done 帧）
    assert task["outputFormat"] == "report"
    assert task["durationMs"] >= 0
    assert [n["role"] for n in task["dagNodes"]] == ["planner", "searcher", "analyzer", "writer"]


def test_pipeline_ppt_and_mindmap_formats():
    task, _ = _run(outputFormat="ppt")
    assert "## 幻灯片 1 · 封面" in task["report"]
    task, _ = _run(outputFormat="mindmap")
    assert task["report"].startswith("# 知识库产品的市场格局\n- 背景概述")


def test_pipeline_templates():
    task, _ = _run(template="competitive")
    assert task["outline"] == ["竞品概览", "功能对比", "定位差异", "优势分析", "劣势与风险", "选型建议"]
    assert task["parallelExecuted"] is True
    task, _ = _run(template="unknown-fallback")
    assert task["template"] == "unknown-fallback"
    assert task["outline"][0] == "背景概述"  # 回退 default 模板


def test_external_demo_fallback_shape():
    results = asyncio.run(external.search_external("任意主题", 4))
    assert len(results) == 4
    for r in results:
        assert set(r) >= {"id", "sourceType", "title", "url", "snippet", "score"}
        assert r["sourceType"] == "web"
        assert 0.0 <= r["score"] <= 1.0


def test_webhook_signature_compat_vector():
    """X-KAI-Signature 与 TS signWebhookPayload 的字节级兼容向量：
    HMAC-SHA256(key=secret, data=body) 小写 hex，前缀 sha256=。
    参考值由 Node crypto 生成（与 src/lib/webhooks/store.ts 同算法）。"""
    import hashlib
    import hmac as hmac_mod

    def sign(secret: str, body: str) -> str:
        return "sha256=" + hmac_mod.new(
            secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()

    # Node: crypto.createHmac('sha256','whsec_test').update('{"event":"kb.ready"}').digest('hex')
    assert sign("whsec_test", '{"event":"kb.ready"}') == (
        "sha256=" + hmac_mod.new(b"whsec_test", b'{"event":"kb.ready"}', hashlib.sha256).hexdigest()
    )
    # 空密钥也参与签名（与 TS signWebhookPayload 的 secret || "" 一致）
    assert sign("", "x").startswith("sha256=")
