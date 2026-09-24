---
title: 三语言 SDK 使用指南
description: KnowledgeAI 官方 JavaScript / Python / Go SDK 使用指南：零依赖引入、初始化、流式问答、Agent 调研与错误处理
type: how-to
category: api
level: L2
version: 1.0.0
authors: [technical-writer]
owner: api-owner
reviewed_at: 2026-09-23
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [guide.md, reference.md, errors.md, webhooks.md]
---

# 三语言 SDK 使用指南

> KnowledgeAI 官方提供 **JavaScript / Python / Go** 三套零依赖 SDK，接口语义一致：JavaScript 使用全局 `fetch` + `ReadableStream`（Node 18+ 与现代浏览器），Python 仅用标准库（Python 3.8+），Go 仅用标准库并支持 `context.Context` 取消传播。

## 引入与初始化

```javascript
// JavaScript：sdk/javascript/kai-sdk.mjs
import { KnowledgeAI } from "kai-sdk.mjs";

const kai = new KnowledgeAI({
  apiKey: "kai_sk_...",
  baseUrl: "http://localhost:3000", // 默认 localhost:3000
});
```

```python
# Python：sdk/python/kai_sdk.py
from kai_sdk import KnowledgeAI

kai = KnowledgeAI(
    api_key="kai_sk_...",
    base_url="http://localhost:3000",  # 默认 localhost:3000
    timeout=60,                        # 请求超时（秒）
)
```

```go
// Go：sdk/go/kai.go（模块名见 sdk/go/go.mod）
import "knowledgeai/sdk/go/kai" // 按你的模块路径引用

client := kai.New("kai_sk_...", "http://localhost:3000")
```

## 方法对照表

| 能力 | JavaScript | Python | Go | 端点 |
|------|-----------|--------|-----|------|
| 当前用户 | `me()` | `me()` | `Me(ctx)` | `GET /api/v1/me` |
| 知识库列表 | `listKnowledgeBases()` | `list_knowledge_bases()` | `ListKnowledgeBases(ctx)` | `GET /api/v1/knowledge-bases` |
| 创建知识库 | `createKnowledgeBase({ name, desc?, color? })` | `create_knowledge_base(name, desc="", color=None)` | `CreateKnowledgeBase(ctx, name, desc, color)` | `POST /api/v1/knowledge-bases` |
| 流式问答 | `ask(kbId, query, opts?)` | `ask(kb_id, query, on_token=None, on_sources=None, web_search=False, timeout=None)` | `Ask(ctx, kbID, query, onToken)` | `POST /api/v1/chat` |
| Agent 调研 | `runAgent(topic, opts?)` | `run_agent(topic, on_step=None)` | `RunAgent(ctx, topic)` | `POST /api/v1/agent/run` |
| Webhook 管理 | `listWebhooks()` / `createWebhook({...})` / `deleteWebhook(id)` | `list_webhooks()` / `create_webhook(url, events, name="", secret="")` / `delete_webhook(id)` | `ListWebhooks(ctx)` / `CreateWebhook(ctx, url, events, name, secret)` / `DeleteWebhook(ctx, id)` | `/api/v1/webhooks*` |

Scope 要求：知识库列表 `kb:read`、创建知识库 `kb:write`、流式问答 `chat:read`、Agent 调研 `agent:run`；JWT 会话调用 v1 不受 scope 限制（走 RBAC）。

## JavaScript SDK

### 流式问答

```javascript
await kai.ask("kb_xxxxxx", "产品支持哪些文档格式？", {
  onSources: (sources) => console.log(`检索到 ${sources.length} 条来源`),
  onToken: (token) => process.stdout.write(token), // 增量输出
  webSearch: false,   // 关闭联网搜索（true 开启，来源经 onSources 返回）
  topK: 5,            // 检索条数（1–20）
  conversationId: undefined, // 续接会话
});
// 返回 Promise<{ messageId, conversationId, citations, followUps }>
```

### Agent 调研

```javascript
const task = await kai.runAgent("2026 年大模型行业趋势", {
  kbId: "kb_xxxxxx",      // 可选，限定知识库
  onStep: (step) => console.log(`[${step.role}] ${step.detail}`),
});
console.log("报告完成：", task.title);
```

### 错误处理

```javascript
import { KnowledgeAI, KnowledgeAIError } from "kai-sdk.mjs";

try {
  await kai.listKnowledgeBases();
} catch (err) {
  if (err instanceof KnowledgeAIError) {
    console.error(err.status, err.message); // 如 403 + "API Key 缺少所需 scope"
  }
}
```

`KnowledgeAIError` 携带 `status`（HTTP 状态码）与原始 `body`。429 限流时读取 `err.body.retryAfter` 退避重试。

## Python SDK

### 流式问答

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

### Agent 调研

```python
def on_step(step: dict) -> None:
    print(f"[{step.get('role')}] {step.get('detail')}")

task = kai.run_agent("2026 年大模型行业趋势", on_step=on_step)
print("报告完成：", task["title"])
```

### 错误处理

```python
from kai_sdk import KnowledgeAIError

try:
    kai.list_knowledge_bases()
except KnowledgeAIError as e:
    print(e.status, e.message)  # 如 429 + 限流信息（body 含 retryAfter）
```

`KnowledgeAIError` 携带 `status` 与 `body`；429 时读取 `body["retryAfter"]` 退避重试。

## Go SDK

### 流式问答

```go
ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
defer cancel()

result, err := client.Ask(ctx, "kb_xxxxxx", "产品支持哪些文档格式？", func(t string) {
    fmt.Print(t) // 增量 token
})
if err != nil {
    log.Fatal(err)
}
fmt.Println("\n引用数：", len(result.Citations))
```

### Agent 调研

```go
task, err := client.RunAgent(ctx, "2026 年大模型行业趋势")
if err != nil {
    log.Fatal(err)
}
fmt.Println("报告完成：", task["title"])
```

### 错误处理

```go
var apiErr *kai.APIError
if err := client.Me(ctx); err != nil {
    if errors.As(err, &apiErr) {
        fmt.Println(apiErr.Status, apiErr.Message) // 如 429 限流
    }
}
```

`APIError` 携带 `Status` 与原始响应；429 时按 `Retry-After` 退避重试。所有方法接受 `context.Context`，可配合取消传播中断请求。

## 相关文档

- [API 使用指南](guide.md)
- [API 参考（端点明细）](reference.md)
- [错误码表](errors.md) · [Webhook 指南](webhooks.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-09-23 | 合并原 JavaScript / Python / Go 三篇 SDK 文档为单页，方法一览改为三语言对照表 |
