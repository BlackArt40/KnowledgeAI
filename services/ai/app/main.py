# ---------------------------------------------------------------------------
# KnowledgeAI AI 服务（阶段 1 服务拆分，docs/architecture/service-split.md）。
#
# 契约（不可谈判项）：
#   1. 仅内网：所有 /internal/* 必须携带 X-Internal-Token（未配置令牌 = 全部 401，
#      fail-closed）。Python 不解析用户 JWT、不做业务鉴权 —— 租户身份由 BFF 注入
#      并已校验（service-split.md 契约 #2）。
#   2. 检索强制 workspace_id + kb_id 双匹配（跨租户恒 0 hits，契约 #5）。
#   3. SSE 线上格式与现网一致：`data: {"type": ...}\n\n` JSON 帧。
# ---------------------------------------------------------------------------
from __future__ import annotations

import json
import logging
import time
from typing import AsyncGenerator, List, Optional
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import settings
from .chunker import chunk_text
from .generation import generate_stream
from .parser import ParseError, extract_text
from .retrieval import chunk_to_payload, hybrid_search
from .store import get_store, reset_store

logger = logging.getLogger("kai.ai")


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "level": record.levelname.lower(),
            "time": int(record.created * 1000),
            "msg": record.getMessage(),
        }
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        return json.dumps(payload, ensure_ascii=False)


def _setup_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO))


_setup_logging()

# ---------------------------------------------------------------------------
# 生命周期：启动 Agent worker（心跳 + 队列消费，阶段 5）；关闭时优雅退出。
# ---------------------------------------------------------------------------
import contextlib


@contextlib.asynccontextmanager
async def _lifespan(app: FastAPI):
    from . import agentqueue

    agentqueue.start_worker()
    try:
        yield
    finally:
        await agentqueue.stop_worker()


app = FastAPI(title="KnowledgeAI AI Service", version="1.0.0", docs_url=None, redoc_url=None,
              lifespan=_lifespan)

TRACE_HEADER = "X-Trace-Id"

_BAD_HOST_PREFIXES = ("127.", "10.", "192.168.", "169.254.", "172.16.", "172.17.", "172.18.", "172.19.", "172.30.", "172.31.")


class _HttpException(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


@app.exception_handler(_HttpException)
async def _http_exception_handler(_request: Request, exc: _HttpException):
    return JSONResponse(status_code=exc.status, content={"ok": False, "code": exc.code, "message": exc.message})


# ---------------------------------------------------------------------------
# 内部鉴权 + 访问日志
# ---------------------------------------------------------------------------


@app.middleware("http")
async def _auth_and_logging(request: Request, call_next):
    started = time.monotonic()
    trace_id = request.headers.get(TRACE_HEADER, "")

    if request.url.path.startswith("/internal"):
        token = request.headers.get("X-Internal-Token", "")
        if not settings.AI_INTERNAL_TOKEN or token != settings.AI_INTERNAL_TOKEN:
            _log(logging.WARNING, "internal request unauthorized", request, 401, started, trace_id)
            return JSONResponse(
                status_code=401,
                content={"ok": False, "code": "unauthorized", "message": "missing or invalid X-Internal-Token"},
            )

    try:
        response = await call_next(request)
    except Exception:
        _log(logging.ERROR, "http request failed", request, 500, started, trace_id)
        raise
    if trace_id:
        response.headers[TRACE_HEADER] = trace_id
    _log(logging.INFO, "http request", request, response.status_code, started, trace_id)
    return response


def _log(level: int, msg: str, request: Request, status: int, started: float, trace_id: str) -> None:
    logger.log(
        level,
        msg,
        extra={
            "fields": {
                "method": request.method,
                "path": request.url.path,
                "status": status,
                "durationMs": round((time.monotonic() - started) * 1000, 1),
                "traceId": trace_id,
            }
        },
    )


# ---------------------------------------------------------------------------
# 健康检查（无鉴权；compose 健康探针用）
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "service": "ai", "chunks": get_store().total_chunks()}


# ---------------------------------------------------------------------------
# 请求模型
# ---------------------------------------------------------------------------


class IndexSource(BaseModel):
    type: str = "presignedUrl"  # "presignedUrl" | "s3" | "content" | "binary"
    url: Optional[str] = None       # presignedUrl：短 TTL 预签名 GET（BFF 生成）
    bucket: Optional[str] = None    # s3：缺省用 S3_BUCKET 环境变量
    key: Optional[str] = None       # s3：对象 key（必填）
    content: Optional[str] = None   # content：内联文本（text-like 文档）
    contentB64: Optional[str] = None  # binary：base64 二进制（pdf/docx/xlsx，按 mime 解析）


class IndexSettings(BaseModel):
    chunkSize: int = 512
    chunkOverlap: int = 64


class IndexRequest(BaseModel):
    workspaceId: str
    kbId: str
    docId: str
    filename: str
    mime: str = ""
    source: IndexSource
    settings: IndexSettings = Field(default_factory=IndexSettings)


class RetrieveRequest(BaseModel):
    workspaceId: str
    kbId: str
    query: str
    topK: int = 5


class HistoryMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChunkIn(BaseModel):
    docId: str
    docName: str = ""
    chunkIndex: int = 0
    text: str
    score: float = 0.0
    url: Optional[str] = None
    sourceType: Optional[str] = None


class ChatStreamRequest(BaseModel):
    workspaceId: str
    kbId: str
    conversationId: str = ""
    query: str
    chunks: Optional[List[ChunkIn]] = None  # BFF 已过滤的检索结果（权威）；缺省则服务端检索
    history: List[HistoryMessage] = Field(default_factory=list)
    temperature: float = 0.3
    topK: int = 5


# ---------------------------------------------------------------------------
# 索引源加载（file:// 限制在 AI_UPLOADS_DIR 内；http(s) 有 SSRF 基线）
# ---------------------------------------------------------------------------


class SourceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _assert_public_http(url: str) -> None:
    """SSRF 基线：拒绝回环/私网/链路本地字面量与云元数据地址，但放行
    已配置的 S3 端点主机（内网 MinIO 是该部署的生产配置）。DNS 解析级复查
    在预签名 URL 模式下由对象存储签名兜底（伪造的查询参数无法通过签名校验）。"""
    host = (urlparse(url).hostname or "").lower()
    if settings.AI_ALLOW_PRIVATE_FETCH or settings.is_s3_endpoint_host(host):
        return
    if (
        host in ("localhost", "0.0.0.0", "::1", "")
        or host.endswith(".local")
        or host.startswith(_BAD_HOST_PREFIXES)
    ):
        raise SourceError("forbidden_source", "内网地址被抓取且未开启 AI_ALLOW_PRIVATE_FETCH")


_s3_client = None


def _get_s3_client():
    """source.type=s3 的对象拉取客户端（boto3，凭据来自环境变量）。"""
    global _s3_client
    if _s3_client is None:
        if not settings.s3_enabled():
            raise SourceError("invalid_request", "AI 服务未配置 S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY，不支持 source.type=s3")
        import boto3
        from botocore.config import Config

        path_style = "amazonaws.com" not in settings.S3_ENDPOINT
        _s3_client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT,
            region_name=settings.S3_REGION,
            aws_access_key_id=settings.S3_ACCESS_KEY,
            aws_secret_access_key=settings.S3_SECRET_KEY,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path" if path_style else "virtual"}),
        )
    return _s3_client


def _load_source(source: IndexSource) -> bytes:
    if source.type == "binary":
        # 阶段 4 迭代项：业务服务 base64 直传二进制（pdf/docx/xlsx），服务端按 mime 解析
        if not source.contentB64:
            raise SourceError("invalid_request", "source.contentB64 为空")
        import base64

        try:
            data = base64.b64decode(source.contentB64, validate=False)
        except Exception as e:
            raise SourceError("invalid_request", "contentB64 不是合法 base64") from e
        if not data:
            raise SourceError("invalid_request", "解码后内容为空")
        if len(data) > settings.MAX_INLINE_CONTENT_BYTES:
            raise SourceError("payload_too_large", "二进制内容超过上限")
        return data

    if source.type == "content":
        if not source.content:
            raise SourceError("invalid_request", "source.content 为空")
        data = source.content.encode("utf-8")
        if len(data) > settings.MAX_INLINE_CONTENT_BYTES:
            raise SourceError("payload_too_large", "内联内容超过上限")
        return data

    if source.type == "presignedUrl":
        url = (source.url or "").strip()
        if not (url.startswith("http://") or url.startswith("https://")):
            raise SourceError("invalid_request", "presignedUrl 仅支持 http(s)://")
        _assert_public_http(url)
        try:
            res = httpx.get(url, timeout=settings.FETCH_TIMEOUT_S, follow_redirects=True)
            res.raise_for_status()
        except SourceError:
            raise
        except Exception as e:
            # 403/404（签名过期 / 对象不存在）与网络错误统一为 fetch_error
            raise SourceError("fetch_error", "预签名对象下载失败（可能已过期或对象不存在）") from e
        if len(res.content) > settings.MAX_FETCH_BYTES:
            raise SourceError("payload_too_large", "对象超过大小上限")
        return res.content

    if source.type == "s3":
        key = (source.key or "").strip()
        if not key:
            raise SourceError("invalid_request", "source.key 必填")
        bucket = (source.bucket or "").strip() or settings.S3_BUCKET
        try:
            obj = _get_s3_client().get_object(Bucket=bucket, Key=key)
            data = obj["Body"].read()
        except SourceError:
            raise
        except Exception as e:
            raise SourceError("fetch_error", "S3 对象下载失败（可能不存在或凭据无效）") from e
        if len(data) > settings.MAX_FETCH_BYTES:
            raise SourceError("payload_too_large", "对象超过大小上限")
        return data

    raise SourceError(
        "invalid_request",
        "source.type 仅支持 presignedUrl / s3 / content（阶段 1 的 file:// 共享卷协议已随阶段 2 下线）",
    )


# ---------------------------------------------------------------------------
# /internal 端点
# ---------------------------------------------------------------------------


@app.post("/internal/index")
async def internal_index(req: IndexRequest) -> dict:
    if not req.workspaceId or not req.kbId or not req.docId:
        raise _HttpException(400, "invalid_request", "workspaceId / kbId / docId 必填")
    if not req.filename and not req.mime:
        raise _HttpException(400, "invalid_request", "filename 与 mime 至少一项必填")

    # 阶段 3 A3.2：workspace 与 kb 归属不一致 → 400（纵深防御：
    # 即使 BFF 误传租户，已归属的 KB 也不会被其他租户写入或覆盖）
    existing_ws = get_store().get_kb_ownership(req.kbId)
    if existing_ws and existing_ws != req.workspaceId:
        raise _HttpException(400, "tenant_mismatch", "kbId 已归属其他 workspace，拒绝写入")

    try:
        data = _load_source(req.source)
        text, _doc_type = extract_text(req.filename, req.mime, data)
    except SourceError as e:
        return {"ok": False, "code": e.code, "message": e.message}
    except ParseError as e:
        return {"ok": False, "code": e.code, "message": e.message}

    text = text[: settings.MAX_TEXT_CHARS]
    if not text.strip():
        return {"ok": False, "code": "parse_error", "message": "未解析出文本内容"}

    chunks = chunk_text(text, max(64, req.settings.chunkSize), max(0, req.settings.chunkOverlap))
    from .embeddings import embed_batch

    vectors = await embed_batch(chunks)
    count = get_store().index_chunks(req.workspaceId, req.kbId, req.docId, req.filename, chunks, vectors)
    return {"ok": True, "chunks": count}


@app.delete("/internal/index/{kb_id}/{doc_id}")
async def internal_delete_doc(kb_id: str, doc_id: str, workspaceId: str = "") -> dict:
    _check_delete_tenant(kb_id, workspaceId)
    get_store().clear_doc(kb_id, doc_id)
    return {"ok": True}


@app.delete("/internal/index/{kb_id}")
async def internal_delete_kb(kb_id: str, workspaceId: str = "") -> dict:
    _check_delete_tenant(kb_id, workspaceId)
    get_store().clear_kb(kb_id)
    return {"ok": True}


def _check_delete_tenant(kb_id: str, workspace_id: str) -> None:
    """阶段 3：删除路径同样强制租户过滤（手册 3.1「所有 delete 强制过滤」）。
    - workspaceId 缺失 → 400；与已索引分块的归属不一致 → 403；
    - 索引已空（幂等重复删除）→ 放行。"""
    if not workspace_id:
        raise _HttpException(400, "invalid_request", "workspaceId 必填（delete 强制租户过滤）")
    existing_ws = get_store().get_kb_ownership(kb_id)
    if existing_ws and existing_ws != workspace_id:
        raise _HttpException(403, "tenant_mismatch", "kbId 归属其他 workspace，拒绝删除")


@app.post("/internal/retrieve")
async def internal_retrieve(req: RetrieveRequest) -> dict:
    if not req.workspaceId or not req.kbId:
        raise _HttpException(400, "invalid_request", "workspaceId / kbId 必填")
    if not req.query.strip():
        raise _HttpException(400, "invalid_request", "query 必填")
    top_k = min(max(req.topK, 1), 20)
    hits = await hybrid_search(req.workspaceId, req.kbId, req.query.strip(), top_k)
    return {"ok": True, "chunks": [chunk_to_payload(chunk, score) for chunk, score in hits]}


@app.post("/internal/chat/stream")
async def internal_chat_stream(req: ChatStreamRequest):
    if not req.workspaceId or not req.kbId:
        raise _HttpException(400, "invalid_request", "workspaceId / kbId 必填")
    if not req.query.strip():
        raise _HttpException(400, "invalid_request", "query 必填")

    query = req.query.strip()
    if req.chunks is not None:
        # BFF 已过滤的检索结果（私档过滤 / 降权 / 联网合并）—— 作为生成上下文
        chunks = [c.model_dump() for c in req.chunks]
    else:
        top_k = min(max(req.topK, 1), 20)
        hits = await hybrid_search(req.workspaceId, req.kbId, query, top_k)
        chunks = [chunk_to_payload(chunk, score) for chunk, score in hits]

    async def stream() -> AsyncGenerator[bytes, None]:
        def frame(obj: dict) -> bytes:
            return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")

        yield frame({
            "type": "sources",
            "count": len(chunks),
            "chunks": [
                {
                    "n": 0,
                    "docId": c["docId"],
                    "docName": c.get("docName", ""),
                    "chunkIndex": c.get("chunkIndex", 0),
                    "snippet": c["text"][:180],
                    "score": c.get("score", 0),
                    **({"url": c["url"]} if c.get("url") else {}),
                    **({"sourceType": c["sourceType"]} if c.get("sourceType") else {}),
                }
                for c in chunks
            ],
        })

        history = [
            {"role": m.role, "content": m.content}
            for m in req.history
            if m.role in ("user", "assistant")
        ]
        from .generation import GenerationResult

        result = GenerationResult()
        gen = generate_stream(query, chunks, history, req.temperature, result)
        while True:
            try:
                kind, text = await gen.__anext__()
            except StopAsyncIteration:
                break
            except Exception:
                # 生成中途失败：显式 error 帧（与现网 {type:"error"} 语义一致）
                logger.exception("generation failed")
                yield frame({"type": "error", "message": "生成回答时出错，请重试。"})
                return
            if kind == "token" and text:
                yield frame({"type": "token", "text": text})
        yield frame({"type": "done", "text": result.text, "citations": result.citations})

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(stream(), media_type="text/event-stream; charset=utf-8", headers=headers)


@app.post("/internal/testing/reset")
async def internal_testing_reset() -> dict:
    """仅供测试（受同一内部令牌保护）。"""
    reset_store()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Agent 任务入队（阶段 5，手册 5.2/5.3）：
#   POST /internal/agent/run —— 校验载荷 → 深度上限检查（QUEUE_MAX_DEPTH，
#   超限 429 queue_busy，ADR-0007/0008）→ LPUSH agent:queue。
#   执行与进度发布在 worker（agentqueue）：channel agent:<taskId>，
#   帧 step/done/error/end（init 由业务服务在 SSE 打开时自行发送）。
# ---------------------------------------------------------------------------


class AgentRunJob(BaseModel):
    taskId: str
    workspaceId: str
    topic: str
    kbId: Optional[str] = None
    kbName: Optional[str] = None
    outputFormat: str = "report"
    agents: Optional[List[str]] = None
    maxSteps: int = 5
    template: str = "default"
    userId: Optional[str] = None
    createdAt: Optional[int] = None


@app.post("/internal/agent/run")
async def internal_agent_run(job: AgentRunJob) -> JSONResponse:
    from . import agentqueue

    if not job.taskId or not job.workspaceId or not job.topic.strip():
        return JSONResponse(status_code=400, content={
            "ok": False, "code": "invalid_request", "message": "taskId/workspaceId/topic 必填"})
    depth = await agentqueue.queue_depth()
    if depth >= settings.QUEUE_MAX_DEPTH:
        logger.warning("agent queue full", extra={"fields": {
            "depth": depth, "maxDepth": settings.QUEUE_MAX_DEPTH, "taskId": job.taskId}})
        return JSONResponse(status_code=429, content={
            "ok": False, "code": "queue_busy",
            "message": "系统繁忙（任务队列已满），请稍后重试",
            "depth": depth, "maxDepth": settings.QUEUE_MAX_DEPTH})
    await agentqueue.enqueue_agent_run(job.model_dump())
    return JSONResponse(status_code=202, content={
        "ok": True, "queued": True, "depth": depth + 1, "maxDepth": settings.QUEUE_MAX_DEPTH})
