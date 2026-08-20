---
title: JavaScript SDK
description: KnowledgeAI JavaScript SDK 使用指南：零依赖、Node 18+ 与浏览器可用、SSE 流式回调
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
related: [guide.md, sdk-python.md, sdk-go.md]
---

# JavaScript SDK

> 官方 JS SDK（`sdk/javascript/kai-sdk.mjs`）零依赖，使用全局 `fetch` + `ReadableStream`，**Node 18+ 与现代浏览器均可运行**，无需安装任何包。

## 引入与初始化

```javascript
import { KnowledgeAI } from "kai-sdk.mjs";

const kai = new KnowledgeAI({
  apiKey: "kai_sk_...",
  baseUrl: "http://localhost:3000", // 默认 localhost:3000
});
```

## 方法一览

| 方法 | 对应端点 | 说明 |
|------|----------|------|
| `me()` | `GET /api/v1/me` | 当前用户信息（校验凭据） |
| `listKnowledgeBases()` | `GET /api/v1/knowledge-bases` | 知识库列表（需 `kb:read`） |
| `createKnowledgeBase({ name, desc?, color? })` | `POST /api/v1/knowledge-bases` | 创建知识库（需 `kb:write`） |
| `ask(kbId, query, opts?)` | `POST /api/v1/chat` | 流式问答（需 `chat:read`） |
| `runAgent(topic, opts?)` | `POST /api/v1/agent/run` | Agent 调研（需 `agent:run`） |
| `listWebhooks()` / `createWebhook({...})` / `deleteWebhook(id)` | `/api/v1/webhooks*` | Webhook 订阅管理 |

## 示例：流式问答

```javascript
await kai.ask("kb_xxxxxx", "产品支持哪些文档格式？", {
  onSources: (sources) => console.log(`检索到 ${sources.length} 条来源`),
  onToken: (token) => process.stdout.write(token), // 增量输出
  webSearch: false,   // 开启联网搜索
  topK: 5,            // 检索条数（1–20）
  conversationId: undefined, // 续接会话
});
// 返回 Promise<{ messageId, conversationId, citations, followUps }>
```

## 示例：Agent 调研

```javascript
const task = await kai.runAgent("2026 年大模型行业趋势", {
  kbId: "kb_xxxxxx",      // 可选，限定知识库
  onStep: (step) => console.log(`[${step.role}] ${step.detail}`),
});
console.log("报告完成：", task.title);
```

## 错误处理

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

## 相关文档

- [API 使用指南](guide.md)
- [Python SDK](sdk-python.md) · [Go SDK](sdk-go.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版（依据 kai-sdk.mjs 源码核对） |
