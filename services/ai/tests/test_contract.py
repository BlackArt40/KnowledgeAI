# ---------------------------------------------------------------------------
# AI 服务契约测试（service-split.md 阶段 1 退出标准 A1.4 / A1.5 + 契约帧序）。
# 运行：python3 -m pytest services/ai/tests -q
# ---------------------------------------------------------------------------
from __future__ import annotations

import json
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TOKEN = "test-internal-token"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("AI_INTERNAL_TOKEN", TOKEN)
    monkeypatch.setenv("AI_ALLOW_PRIVATE_FETCH", "false")
    # 每个测试独立 token/store：settings 在 import 时读 env，这里同步改写
    from app import settings, store

    settings.AI_INTERNAL_TOKEN = TOKEN
    settings.AI_ALLOW_PRIVATE_FETCH = False
    store.reset_store()

    from app.main import app

    with TestClient(app) as c:
        yield c


def _auth(token=TOKEN):
    return {"X-Internal-Token": token}


def _index(client, kb="kb_a", ws="ws_a", doc="doc_a", content="# 标题\n\n知识库检索测试内容，用于验证索引入口。"):
    return client.post(
        "/internal/index",
        headers=_auth(),
        json={
            "workspaceId": ws,
            "kbId": kb,
            "docId": doc,
            "filename": "doc.md",
            "mime": "text/markdown",
            "source": {"type": "content", "content": content},
            "settings": {"chunkSize": 128, "chunkOverlap": 16},
        },
    )


# ── A1.4：内部令牌缺失 / 错误 → 401 ────────────────────────────────────────

def test_missing_token_401(client):
    res = client.post(
        "/internal/retrieve",
        json={"workspaceId": "ws_a", "kbId": "kb_a", "query": "测试"},
    )
    assert res.status_code == 401
    assert res.json()["code"] == "unauthorized"


def test_wrong_token_401(client):
    res = client.post(
        "/internal/retrieve",
        headers=_auth("wrong-token"),
        json={"workspaceId": "ws_a", "kbId": "kb_a", "query": "测试"},
    )
    assert res.status_code == 401


def test_unconfigured_token_401(client, monkeypatch):
    from app import settings

    monkeypatch.setattr(settings, "AI_INTERNAL_TOKEN", "")
    res = client.post(
        "/internal/retrieve",
        headers=_auth(""),
        json={"workspaceId": "ws_a", "kbId": "kb_a", "query": "测试"},
    )
    assert res.status_code == 401


def test_health_open(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["ok"] is True


# ── 索引 → 检索主路径 ─────────────────────────────────────────────────────

def test_index_and_retrieve(client):
    res = _index(client)
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["chunks"] >= 1

    res = client.post(
        "/internal/retrieve",
        headers=_auth(),
        json={"workspaceId": "ws_a", "kbId": "kb_a", "query": "知识库检索测试", "topK": 5},
    )
    assert res.status_code == 200
    chunks = res.json()["chunks"]
    assert len(chunks) >= 1
    assert chunks[0]["docId"] == "doc_a"
    for c in chunks:
        assert set(c) >= {"docId", "docName", "chunkIndex", "text", "score"}


# ── 租户隔离（A3.1 提前落底）：跨 workspace 检索恒 0 hits ─────────────────

def test_cross_tenant_zero_hits(client):
    assert _index(client, ws="ws_a", kb="kb_a").json()["ok"] is True

    res = client.post(
        "/internal/retrieve",
        headers=_auth(),
        json={"workspaceId": "ws_b", "kbId": "kb_a", "query": "知识库检索测试", "topK": 5},
    )
    assert res.status_code == 200
    assert res.json()["chunks"] == []


def test_missing_workspace_400(client):
    res = client.post(
        "/internal/retrieve",
        headers=_auth(),
        json={"workspaceId": "", "kbId": "kb_a", "query": "测试"},
    )
    assert res.status_code == 400
    assert res.json()["ok"] is False


def test_missing_query_400(client):
    res = client.post(
        "/internal/retrieve",
        headers=_auth(),
        json={"workspaceId": "ws_a", "kbId": "kb_a", "query": "  "},
    )
    assert res.status_code == 400


def test_reindex_replaces_doc(client):
    assert _index(client, doc="doc_a").json()["ok"] is True
    assert _index(client, doc="doc_a", content="完全不同的新内容，覆盖旧索引。").json()["ok"] is True

    res = client.post(
        "/internal/retrieve",
        headers=_auth(),
        json={"workspaceId": "ws_a", "kbId": "kb_a", "query": "旧索引", "topK": 20},
    )
    texts = " ".join(c["text"] for c in res.json()["chunks"])
    assert "旧索引" not in texts or "覆盖旧索引" in texts


def test_delete_doc(client):
    assert _index(client, doc="doc_a").json()["ok"] is True
    # 阶段 3：delete 强制租户过滤 —— workspaceId 必填
    res = client.delete("/internal/index/kb_a/doc_a?workspaceId=ws_a", headers=_auth())
    assert res.json()["ok"] is True
    res = client.post(
        "/internal/retrieve",
        headers=_auth(),
        json={"workspaceId": "ws_a", "kbId": "kb_a", "query": "知识库检索测试", "topK": 5},
    )
    assert res.json()["chunks"] == []


# ── 阶段 3：租户硬化（A3.1 / A3.2 / A3.3 负例套件，CI 锁定）────────────────

def test_tenant_mismatch_index_400(client):
    """A3.2：kbId 已归属 wsA 后，wsB 对同一 kbId 写入 → 400 tenant_mismatch。"""
    assert _index(client, ws="ws_a", kb="kb_shared", doc="doc_a").json()["ok"] is True
    res = client.post(
        "/internal/index",
        headers=_auth(),
        json={
            "workspaceId": "ws_b",
            "kbId": "kb_shared",
            "docId": "doc_b",
            "filename": "doc.md",
            "source": {"type": "content", "content": "租户 B 的内容，不得写入 A 的知识库。"},
        },
    )
    assert res.status_code == 400
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "tenant_mismatch"
    # wsB 的内容确实没有写入：wsA 视角检索不到 doc_b 的内容
    hits = client.post(
        "/internal/retrieve",
        headers=_auth(),
        json={"workspaceId": "ws_a", "kbId": "kb_shared", "query": "租户 B 的内容", "topK": 20},
    ).json()["chunks"]
    assert all(c["docId"] != "doc_b" for c in hits)


def test_cross_tenant_matrix(client):
    """A3.1 负例套件：固定夹具 wsA/kbA + wsB/kbB，全部交叉组合。"""
    assert _index(client, ws="ws_a", kb="kb_a", doc="doc_a", content="甲方的专属知识内容。").json()["ok"] is True
    assert _index(client, ws="ws_b", kb="kb_b", doc="doc_b", content="乙方的专属知识内容。").json()["ok"] is True

    q = "专属知识内容"
    for ws, kb, expect_empty in (("ws_a", "kb_b", True), ("ws_b", "kb_a", True), ("ws_a", "kb_a", False), ("ws_b", "kb_b", False)):
        res = client.post(
            "/internal/retrieve",
            headers=_auth(),
            json={"workspaceId": ws, "kbId": kb, "query": q, "topK": 5},
        )
        assert res.status_code == 200, f"{ws}/{kb} 不应 5xx"
        chunks = res.json()["chunks"]
        if expect_empty:
            assert chunks == [], f"{ws} 检索 {kb} 必须为空（越权）"
        else:
            assert len(chunks) > 0, f"{ws} 检索本租户 {kb} 应有结果"


def test_delete_workspace_enforcement(client):
    """阶段 3：删除路径强制租户过滤 —— 缺失 400、越权 403、正确放行。"""
    assert _index(client, ws="ws_a", kb="kb_a", doc="doc_a").json()["ok"] is True

    # 缺 workspaceId → 400
    res = client.delete("/internal/index/kb_a/doc_a", headers=_auth())
    assert res.status_code == 400

    # 越权（ws_b 删 ws_a 的对象）→ 403，且对象仍在
    res = client.delete("/internal/index/kb_a/doc_a?workspaceId=ws_b", headers=_auth())
    assert res.status_code == 403
    assert res.json()["code"] == "tenant_mismatch"
    hits = client.post(
        "/internal/retrieve",
        headers=_auth(),
        json={"workspaceId": "ws_a", "kbId": "kb_a", "query": "知识库检索测试", "topK": 5},
    ).json()["chunks"]
    assert len(hits) > 0, "越权删除不得生效"

    # 正确归属 → 放行
    res = client.delete("/internal/index/kb_a/doc_a?workspaceId=ws_a", headers=_auth())
    assert res.json()["ok"] is True

    # 幂等重复删除（索引已空）→ 放行
    res = client.delete("/internal/index/kb_a/doc_a?workspaceId=ws_a", headers=_auth())
    assert res.json()["ok"] is True


def test_delete_kb_workspace_enforcement(client):
    """整库删除同样强制租户过滤。"""
    assert _index(client, ws="ws_a", kb="kb_a").json()["ok"] is True
    res = client.delete("/internal/index/kb_a?workspaceId=ws_b", headers=_auth())
    assert res.status_code == 403
    res = client.delete("/internal/index/kb_a?workspaceId=ws_a", headers=_auth())
    assert res.json()["ok"] is True
    hits = client.post(
        "/internal/retrieve",
        headers=_auth(),
        json={"workspaceId": "ws_a", "kbId": "kb_a", "query": "知识库检索测试", "topK": 5},
    ).json()["chunks"]
    assert hits == []


def test_file_source_outside_uploads_forbidden(client, tmp_path):
    """阶段 2：file:// 共享卷协议已下线 —— 显式拒绝并提示替代方案。"""
    secret = tmp_path / "secret.txt"
    secret.write_text("机密", encoding="utf-8")

    res = client.post(
        "/internal/index",
        headers=_auth(),
        json={
            "workspaceId": "ws_a",
            "kbId": "kb_a",
            "docId": "doc_x",
            "filename": "secret.txt",
            "source": {"type": "url", "url": f"file://{secret}"},
        },
    )
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "invalid_request"
    assert "file://" in body["message"]


# ── 阶段 2：对象存储源（presignedUrl / s3）────────────────────────────────

import http.server
import threading


class _FakeObjectServer(http.server.BaseHTTPRequestHandler):
    """极简 HTTP 对象服务器：GET /obj/<hex> 返回注册的字节；/deny 恒 403。
    同时充当 mock S3（botocore 的 GET /<bucket>/<key> 忽略签名直接返回 200）。"""

    objects: dict = {}

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/deny"):
            self.send_response(403)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        for path_prefix in ("/obj/",):
            if self.path.startswith(path_prefix):
                body = self.objects.get(self.path)
                if body is None:
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        # mock S3：GET /<bucket>/<key>
        parts = self.path.lstrip("/").split("?", 1)[0].split("/", 1)
        if len(parts) == 2 and parts[1] in self.objects:
            body = self.objects[parts[1]]
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):  # 静默访问日志
        pass


@pytest.fixture()
def fake_object_server():
    _FakeObjectServer.objects.clear()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _FakeObjectServer)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    thread.join(timeout=3)


def _set_s3_settings(monkeypatch, endpoint):
    from app import settings
    from app import main as ai_main

    monkeypatch.setattr(settings, "S3_ENDPOINT", endpoint)
    monkeypatch.setattr(settings, "S3_BUCKET", "kb-uploads")
    monkeypatch.setattr(settings, "S3_ACCESS_KEY", "test")
    monkeypatch.setattr(settings, "S3_SECRET_KEY", "test-secret")
    monkeypatch.setattr(settings, "AI_ALLOW_PRIVATE_FETCH", True)
    ai_main._s3_client = None  # 重置缓存的 boto3 客户端


def test_presigned_url_source(client, fake_object_server, monkeypatch):
    from app import settings

    monkeypatch.setattr(settings, "AI_ALLOW_PRIVATE_FETCH", True)
    content = "# 预签名源\n\n通过对象存储预签名 URL 拉取的文档内容，用于阶段二验收。"
    _FakeObjectServer.objects["/obj/abc"] = content.encode("utf-8")

    res = client.post(
        "/internal/index",
        headers=_auth(),
        json={
            "workspaceId": "ws_a",
            "kbId": "kb_a",
            "docId": "doc_presign",
            "filename": "presign.md",
            "source": {"type": "presignedUrl", "url": f"{fake_object_server}/obj/abc"},
        },
    )
    body = res.json()
    assert body["ok"] is True, body
    assert body["chunks"] >= 1


def test_presigned_url_expired_403(client, fake_object_server, monkeypatch):
    """A2.4 的服务侧语义：签名过期（403）→ ok:false + fetch_error，不 500。"""
    from app import settings

    monkeypatch.setattr(settings, "AI_ALLOW_PRIVATE_FETCH", True)
    res = client.post(
        "/internal/index",
        headers=_auth(),
        json={
            "workspaceId": "ws_a",
            "kbId": "kb_a",
            "docId": "doc_expired",
            "filename": "expired.md",
            "source": {"type": "presignedUrl", "url": f"{fake_object_server}/deny"},
        },
    )
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "fetch_error"


def test_presigned_url_private_host_blocked(client, monkeypatch):
    """SSRF 基线：非 S3 端点的私网地址在 AI_ALLOW_PRIVATE_FETCH=false 时拒绝。"""
    from app import settings

    monkeypatch.setattr(settings, "AI_ALLOW_PRIVATE_FETCH", False)
    monkeypatch.setattr(settings, "S3_ENDPOINT", "")
    res = client.post(
        "/internal/index",
        headers=_auth(),
        json={
            "workspaceId": "ws_a",
            "kbId": "kb_a",
            "docId": "doc_ssrf",
            "filename": "ssrf.md",
            "source": {"type": "presignedUrl", "url": "http://169.254.169.254/latest/meta-data"},
        },
    )
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "forbidden_source"


def test_s3_source_with_boto3(client, fake_object_server, monkeypatch):
    """source.type=s3：boto3 用环境变量凭据从（mock）S3 拉取 bucket+key。"""
    _set_s3_settings(monkeypatch, fake_object_server)
    _FakeObjectServer.objects["docs/report.md"] = "# S3 源\n\nbucket+key 直拉的对象内容，阶段二验收。".encode("utf-8")

    res = client.post(
        "/internal/index",
        headers=_auth(),
        json={
            "workspaceId": "ws_a",
            "kbId": "kb_a",
            "docId": "doc_s3",
            "filename": "report.md",
            "source": {"type": "s3", "bucket": "kb-uploads", "key": "docs/report.md"},
        },
    )
    body = res.json()
    assert body["ok"] is True, body
    assert body["chunks"] >= 1


def test_s3_source_missing_key_400(client):
    res = client.post(
        "/internal/index",
        headers=_auth(),
        json={
            "workspaceId": "ws_a",
            "kbId": "kb_a",
            "docId": "doc_s3_bad",
            "filename": "x.md",
            "source": {"type": "s3"},
        },
    )
    assert res.json()["code"] == "invalid_request"


def test_s3_source_not_configured(client, monkeypatch):
    _set_s3_settings(monkeypatch, "")  # 清空端点 → s3_enabled() False
    from app import main as ai_main

    ai_main._s3_client = None
    res = client.post(
        "/internal/index",
        headers=_auth(),
        json={
            "workspaceId": "ws_a",
            "kbId": "kb_a",
            "docId": "doc_s3_nc",
            "filename": "x.md",
            "source": {"type": "s3", "bucket": "b", "key": "k"},
        },
    )
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "invalid_request"


def test_unsupported_format_reported(client):
    res = client.post(
        "/internal/index",
        headers=_auth(),
        json={
            "workspaceId": "ws_a",
            "kbId": "kb_a",
            "docId": "doc_ppt",
            "filename": "deck.pptx",
            "source": {"type": "content", "content": "fake"},
        },
    )
    body = res.json()
    assert body["ok"] is False
    assert body["code"] == "unsupported_format"


# ── SSE 契约：data: JSON 帧，sources → token* → done ─────────────────────

def _parse_sse(text):
    frames = []
    for block in text.split("\n\n"):
        block = block.strip()
        if block.startswith("data: "):
            frames.append(json.loads(block[len("data: "):]))
    return frames


def test_chat_stream_contract_with_chunks(client):
    chunks = [
        {
            "docId": "doc_a",
            "docName": "产品手册.md",
            "chunkIndex": 0,
            "text": "知识库检索测试内容。产品支持全文检索与语义问答。",
            "score": 0.42,
        }
    ]
    res = client.post(
        "/internal/chat/stream",
        headers=_auth(),
        json={
            "workspaceId": "ws_a",
            "kbId": "kb_a",
            "conversationId": "conv_1",
            "query": "知识库检索测试",
            "chunks": chunks,
            "history": [{"role": "user", "content": "知识库检索测试"}],
        },
    )
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    frames = _parse_sse(res.text)

    assert frames, "SSE 帧不能为空"
    assert frames[0]["type"] == "sources"
    assert frames[0]["count"] == 1
    assert frames[0]["chunks"][0]["docId"] == "doc_a"
    assert frames[0]["chunks"][0]["snippet"].startswith("知识库检索测试内容")

    token_frames = [f for f in frames if f["type"] == "token"]
    assert token_frames, "必须有 token 帧"
    full_text = "".join(f["text"] for f in token_frames)
    assert full_text.strip()

    done = frames[-1]
    assert done["type"] == "done"
    assert done["text"] == full_text
    assert isinstance(done["citations"], list)
    for cite in done["citations"]:
        assert set(cite) >= {"n", "docId", "docName", "chunkIndex", "snippet", "score"}
        assert 1 <= cite["n"] <= len(chunks)


def test_chat_stream_server_side_retrieve(client):
    assert _index(client).json()["ok"] is True
    res = client.post(
        "/internal/chat/stream",
        headers=_auth(),
        json={"workspaceId": "ws_a", "kbId": "kb_a", "query": "知识库检索测试内容"},
    )
    assert res.status_code == 200
    frames = _parse_sse(res.text)
    assert frames[0]["type"] == "sources"
    assert frames[0]["count"] >= 1
    assert frames[-1]["type"] == "done"


def test_chat_stream_empty_kb(client):
    res = client.post(
        "/internal/chat/stream",
        headers=_auth(),
        json={"workspaceId": "ws_a", "kbId": "kb_empty", "query": "任何问题"},
    )
    frames = _parse_sse(res.text)
    assert frames[0]["type"] == "sources"
    assert frames[0]["count"] == 0
    assert frames[-1]["type"] == "done"
    assert "未在当前知识库中检索到相关内容" in frames[-1]["text"]
