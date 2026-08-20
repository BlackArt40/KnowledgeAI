---
title: Python SDK
description: KnowledgeAI Python SDK 使用指南：安装引入、初始化、SSE 流式回调与错误处理
type: how-to
category: api
level: L2
version: 1.0.0
authors: [technical-writer]
owner: api-owner
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [guide.md, sdk-javascript.md, sdk-go.md]
---

# Python SDK

> 官方 Python SDK（`sdk/python/kai_sdk.py`）零第三方依赖，仅使用标准库（`urllib` 实现 HTTP 与 SSE 解析），**Python 3.8+**。

## 引入与初始化

```python
from kai_sdk import KnowledgeAI

kai = KnowledgeAI(
    api_key="kai_sk_...",
    base_url="http://localhost:3000",  # 默认 localhost:3000
    timeout=60,                        # 请求超时（秒）
)
```

## 方法一览

| 方法 | 对应端点 | 说明 |
|------|----------|------|
| `me()` | `GET /api/v1/me` | 当前用户信息 |
| `list_knowledge_bases()` | `GET /api/v1/knowledge-bases` | 知识库列表 |
| `create_knowledge_base(name, desc="", color=None)` | `POST /api/v1/knowledge-bases` | 创建知识库 |
| `ask(kb_id, query, on_token=None, on_sources=None, web_search=False, timeout=None)` | `POST /api/v1/chat` | 流式问答 |
| `run_agent(topic, on_step=None)` | `POST /api/v1/agent/run` | Agent 调研 |
| `list_webhooks()` / `create_webhook(url, events, name="", secret="")` / `delete_webhook(webhook_id)` | `/api/v1/webhooks*` | Webhook 管理 |

## 示例：流式问答

```python
def on_token(token: str) -> None:
    print(token, end="", flush=True)

def on_sources(sources: list) -> None:
    print(f"\n[来源] {len(sources)} 条")

result = kai.ask(
    "kb_xxxxxx",
    "产品支持哪些文档格式？",
    on_token=on_token,
    on_sources=on_sources,
    web_search=False,
)
# result 含 messageId / conversationId / citations / followUps
```

## 示例：Agent 调研

```python
def on_step(step: dict) -> None:
    print(f"[{step.get('role')}] {step.get('detail')}")

task = kai.run_agent("2026 年大模型行业趋势", on_step=on_step)
print("报告完成：", task["title"])
```

## 错误处理

```python
from kai_sdk import KnowledgeAIError

try:
    kai.list_knowledge_bases()
except KnowledgeAIError as e:
    print(e.status, e.message)  # 如 429 + 限流信息（body 含 retryAfter）
```

`KnowledgeAIError` 携带 `status` 与 `body`；429 时读取 `body["retryAfter"]` 退避重试。

## 相关文档

- [API 使用指南](guide.md)
- [JavaScript SDK](sdk-javascript.md) · [Go SDK](sdk-go.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版（依据 kai_sdk.py 源码核对） |
