---
title: Go SDK
description: KnowledgeAI Go SDK 使用指南：安装引入、初始化、SSE 流式回调与错误处理
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
related: [guide.md, sdk-javascript.md, sdk-python.md]
---

# Go SDK

> 官方 Go SDK（`sdk/go/kai.go`）零第三方依赖（仅标准库），支持上下文取消与 SSE 流式回调。模块名见 `sdk/go/go.mod`。

## 引入与初始化

```go
import "knowledgeai/sdk/go/kai" // 按你的模块路径引用

client := kai.New("kai_sk_...", "http://localhost:3000")
```

## 方法一览

| 方法 | 对应端点 | 说明 |
|------|----------|------|
| `Me(ctx)` | `GET /api/v1/me` | 当前用户信息 |
| `ListKnowledgeBases(ctx)` | `GET /api/v1/knowledge-bases` | 知识库列表 |
| `CreateKnowledgeBase(ctx, name, desc, color)` | `POST /api/v1/knowledge-bases` | 创建知识库 |
| `Ask(ctx, kbID, query, onToken)` | `POST /api/v1/chat` | 流式问答（回调返回 `*AskResult`） |
| `RunAgent(ctx, topic)` | `POST /api/v1/agent/run` | Agent 调研 |
| `ListWebhooks(ctx)` / `CreateWebhook(ctx, url, events, name, secret)` / `DeleteWebhook(ctx, id)` | `/api/v1/webhooks*` | Webhook 管理 |

## 示例：流式问答

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

## 示例：Agent 调研

```go
task, err := client.RunAgent(ctx, "2026 年大模型行业趋势")
if err != nil {
    log.Fatal(err)
}
fmt.Println("报告完成：", task["title"])
```

## 错误处理

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
- [JavaScript SDK](sdk-javascript.md) · [Python SDK](sdk-python.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版（依据 kai.go 源码核对） |
