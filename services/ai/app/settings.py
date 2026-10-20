# ---------------------------------------------------------------------------
# 环境配置（与 TS 侧 provider fallback 模式一致：env 门控真实实现 + 演示回退）。
#   AI_INTERNAL_TOKEN     内部调用令牌（BFF -> AI 服务），缺省为空 = 拒绝所有内部调用
#   AI_ALLOW_PRIVATE_FETCH http(s) 源是否允许私网地址（默认 false，fail-closed；
#                          配置了 S3_ENDPOINT 时该端点主机始终放行）
#   S3_ENDPOINT 等        source.type=s3 拉取对象的凭据（与业务侧一致；presignedUrl 不需要）
#   OPENAI_API_KEY 等     配置后走 OpenAI 兼容生成/嵌入，未配置 = 本地抽取式（演示模式）
# ---------------------------------------------------------------------------
from __future__ import annotations

import os
from urllib.parse import urlparse


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


AI_INTERNAL_TOKEN = _env("AI_INTERNAL_TOKEN")
# P2: fail-closed by default. Internal MinIO still works because
# `is_s3_endpoint_host()` always allows the configured S3 endpoint.
AI_ALLOW_PRIVATE_FETCH = _env("AI_ALLOW_PRIVATE_FETCH", "false").lower() in ("1", "true", "yes")

# 阶段 2：对象存储（source.type=s3 用；presignedUrl 由 BFF 生成、无需凭据）
S3_ENDPOINT = _env("S3_ENDPOINT").rstrip("/")
S3_BUCKET = _env("S3_BUCKET", "knowledgeai-uploads")
S3_ACCESS_KEY = _env("S3_ACCESS_KEY")
S3_SECRET_KEY = _env("S3_SECRET_KEY")
S3_REGION = _env("S3_REGION", "us-east-1")

def s3_enabled() -> bool:
    return bool(S3_ENDPOINT and S3_ACCESS_KEY and S3_SECRET_KEY)

def is_s3_endpoint_host(host: str) -> bool:
    """presignedUrl 指向受信对象存储端点时放行（即使未开 AI_ALLOW_PRIVATE_FETCH）。"""
    if not S3_ENDPOINT:
        return False
    ep_host = (urlparse(S3_ENDPOINT).hostname or "").lower()
    return bool(ep_host) and host == ep_host

# 与 TS 侧 kb/store.ts MAX_TEXT（2MiB 字符）对齐
MAX_TEXT_CHARS = 2 * 1024 * 1024
# 索引源大小上限：内联内容 8MB、下载对象 64MB
MAX_INLINE_CONTENT_BYTES = 8 * 1024 * 1024
MAX_FETCH_BYTES = 64 * 1024 * 1024
FETCH_TIMEOUT_S = 30.0

OPENAI_API_KEY = _env("OPENAI_API_KEY")
OPENAI_BASE_URL = _env("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
CHAT_MODEL = _env("CHAT_MODEL", "gpt-4o")
EMBEDDING_MODEL = _env("EMBEDDING_MODEL")
LLM_TIMEOUT_S = 120.0

# 阶段 5：外源搜索凭据（与 TS src/lib/external 同名 env；未配置 = 演示回退）
TAVILY_API_KEY = _env("TAVILY_API_KEY")
SERPAPI_KEY = _env("SERPAPI_KEY")
BRAVE_SEARCH_KEY = _env("BRAVE_SEARCH_KEY")
GITHUB_TOKEN = _env("GITHUB_TOKEN")

LOG_LEVEL = _env("LOG_LEVEL", "info").lower()

# ── 阶段 5：Agent 队列（ADR-0007/0008 背压语义）─────────────────────────────
# Redis 连接（缺省 localhost:6379，与业务服务 REDIS_HOST/REDIS_PORT 同名对齐）
REDIS_HOST = _env("REDIS_HOST", "localhost")
REDIS_PORT = int(_env("REDIS_PORT", "6379") or "6379")
# 队列深度上限：/internal/agent/run 入队前 LLEN 检查，超限 429 queue_busy
QUEUE_MAX_DEPTH = int(_env("QUEUE_MAX_DEPTH", "100") or "100")
QUEUE_KEY = "agent:queue"
WORKER_HEARTBEAT_KEY = "agent:worker:heartbeat"
WORKER_HEARTBEAT_TTL_S = 30
WORKER_HEARTBEAT_INTERVAL_S = 10
# 任务终态快照（业务服务懒回收兜底）：agent:final:{taskId}
AGENT_FINAL_KEY_TTL_S = 7 * 86400


def redis_url() -> str:
    return f"redis://{REDIS_HOST}:{REDIS_PORT}/0"


def llm_enabled() -> bool:
    return bool(OPENAI_API_KEY)


def remote_embedding_enabled() -> bool:
    return bool(OPENAI_API_KEY and EMBEDDING_MODEL)
