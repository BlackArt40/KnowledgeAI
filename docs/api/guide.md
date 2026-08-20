---
title: API 使用指南
description: KnowledgeAI v1 公开 API 快速上手：API Key 鉴权与 scope、SSE 流式协议、限流重试与调用示例
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
related: [reference.md, errors.md, webhooks.md, sdk-javascript.md]
---

# API 使用指南

> 本指南教你从零开始调用 KnowledgeAI 的公开 API（`/api/v1`）：创建密钥 → 首个请求 → 流式问答 → Agent 调研 → 错误处理。端点明细见 [API 参考](reference.md)。

## 快速开始（3 步）

1. **获取 API Key**：登录后进入「设置 → API 密钥」，创建密钥（格式 `kai_sk_xxxxxxxx…`，创建时选择 scope）。密钥仅创建时展示一次，请妥善保存。
2. **验证凭据**：

   ```bash
   curl -s http://localhost:3000/api/v1/me \
     -H "Authorization: Bearer kai_sk_你的密钥"
   ```

   返回你的用户与工作区信息即表示鉴权成功。
3. **发起一次问答**（流式）：

   ```bash
   curl -N -X POST http://localhost:3000/api/v1/chat \
     -H "Authorization: Bearer kai_sk_你的密钥" \
     -H "Content-Type: application/json" \
     -d '{"kbId":"kb_xxxxxx","query":"产品支持哪些文档格式？"}'
   ```

## 鉴权

### API Key（推荐用于服务端集成）

所有 `/api/v1` 端点要求 `Authorization: Bearer <API_KEY>`。API Key 在创建时分配 **scope**，v1 端点按 scope 强制校验：

| Scope | 可访问端点 |
|-------|-----------|
| `kb:read` | `GET /api/v1/knowledge-bases` |
| `kb:write` | `POST /api/v1/knowledge-bases` |
| `chat:read` | `POST /api/v1/chat` |
| `agent:run` | `POST /api/v1/agent/run` |

- 密钥无效 → `401`；密钥缺少所需 scope → `403`（响应体含 `error` 说明）。
- Webhook 管理端点（`/api/v1/webhooks*`）对 API Key 未细分 scope，需要时请使用你的登录会话或按需放行。

### 登录会话（浏览器 / 内部调用）

携带登录 JWT（cookie `kai-token` 或 `Authorization: Bearer <JWT>`）的请求自动通过 v1 scope 校验，路由再按 RBAC 判定权限。

## 端点总览

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` / `POST` | `/api/v1/knowledge-bases` | 知识库列表 / 创建 |
| `POST` | `/api/v1/chat` | 流式智能问答（SSE） |
| `POST` | `/api/v1/agent/run` | Agent 调研（SSE，后台执行） |
| `GET` / `POST` | `/api/v1/webhooks` | Webhook 订阅列表 / 创建 |
| `GET` / `PATCH` / `DELETE` | `/api/v1/webhooks/{id}` | 订阅详情 / 更新 / 删除 |
| `POST` | `/api/v1/webhooks/{id}/test` | 发送测试事件 |
| `GET` | `/api/v1/me` | 当前用户信息 |

> 文档上传等管理操作通过 Web 端 `/api/knowledge-base/[id]` 完成（内部 API），公开 v1 面聚焦「问答 / 调研 / 集成」三类场景。完整字段见 [API 参考](reference.md) 或 `/docs` Swagger UI。

## 流式事件协议（SSE）

### 智能问答 `POST /api/v1/chat`

请求体：`{ kbId, query, conversationId?, webSearch?, topK?, regenerate? }`

响应为 `text/event-stream`，事件顺序：

| 事件 | 载荷 | 说明 |
|------|------|------|
| `sources` | 引用来源数组 | 检索到的文档片段 |
| `token` | 增量文本 | 流式输出，出现多次 |
| `done` | `{ messageId, conversationId, citations, followUps }` | 结束；`citations` 为结构化引用 |
| `error` | `{ message }` | 失败，流结束 |

```bash
curl -N -X POST http://localhost:3000/api/v1/chat \
  -H "Authorization: Bearer kai_sk_..." -H "Content-Type: application/json" \
  -d '{"kbId":"kb_xxxxxx","query":"支持哪些格式？","topK":5}'
# 输出形如：
# event: sources
# data: [...]
# event: token
# data: {"token":"产品支持"}
# event: done
# data: {"messageId":"msg_...","conversationId":"conv_...","citations":[...]}
```

### Agent 调研 `POST /api/v1/agent/run`

请求体：`{ topic, kbId? }`（`kbId` 限定时仅检索该知识库）。任务在后台队列执行，事件顺序：

| 事件 | 载荷 | 说明 |
|------|------|------|
| `init` | `{ taskId }` | 任务已入队 |
| `step` | `{ step }` | 四角色进度（规划/检索/分析/写作） |
| `done` | `{ task }` | 完成，含报告内容与版本信息 |
| `error` | `{ message }` | 失败 |

## 限流与重试

限流在 `src/proxy.ts` 按请求身份分级执行，一次请求只取一个维度：

| 维度 | 默认限制 | 说明 |
|------|----------|------|
| 匿名（IP） | 20 次/分 | `RATE_LIMIT_ANON_PER_MIN` |
| 登录用户 | 可配置 | `RATE_LIMIT_PER_MIN` |
| **API Key** | **500 次/分** | `RATE_LIMIT_KEY_PER_MIN` |
| 知识库 | 60 次/分 | `RATE_LIMIT_KB_PER_MIN`（聊天/加载接口） |

被限流时返回 `429`：

```json
{ "error": "请求过于频繁，请稍后再试", "retryAfter": 30, "dimension": "user" }
```

**处理规范**：读取 `retryAfter`（秒）做指数退避重试（建议退避上限 60s）；SSE 长连接已豁免限流。API Key 场景将 500 次/分视为硬上限，突发场景请降低调用频率或增大 `RATE_LIMIT_KEY_PER_MIN`。

## 错误处理

所有错误响应为 `application/json`，结构：

| 字段 | 说明 |
|------|------|
| `error` | 人类可读错误信息 |
| `retryAfter` | 429 时返回，重试秒数 |
| `dimension` | 429 时返回，限流维度 |

状态码速查：`400` 参数错误（含 scope 缺失的 403）· `401` 未认证 / 密钥无效 · `403` 无权限 / 缺 scope · `404` 资源不存在 · `429` 限流。错误码全表见 [errors.md](errors.md)。

## 使用 SDK

官方提供三语言零依赖 SDK，用法一致：

```javascript
// JavaScript（Node 18+ 或现代浏览器）
import { KnowledgeAI } from "kai-sdk.mjs";
const kai = new KnowledgeAI({ apiKey: "kai_sk_...", baseUrl: "http://localhost:3000" });

const { kbs } = await kai.listKnowledgeBases();
await kai.ask("kb_xxxxxx", "产品支持哪些格式？", {
  onToken: (t) => process.stdout.write(t),
  onSources: (s) => console.log("\n[sources]", s.length),
});
```

```python
# Python
from kai_sdk import KnowledgeAI
kai = KnowledgeAI(api_key="kai_sk_...", base_url="http://localhost:3000")
kai.ask("kb_xxxxxx", "产品支持哪些格式？", on_token=print)
```

```go
// Go
client := kai.New("kai_sk_...", "http://localhost:3000")
client.Ask(ctx, "kb_xxxxxx", "产品支持哪些格式？", func(t string) { fmt.Print(t) })
```

## 典型集成流程

1. 创建知识库 → 2.（Web 端）上传文档等待 `kb.ready` → 3. 流式问答 → 4.（可选）Agent 调研生成报告 → 5.（可选）订阅 Webhook 接收事件。

Webhook 订阅与签名验证见 [webhooks.md](webhooks.md)。

## 相关文档

- [API 参考（端点明细）](reference.md)
- [错误码表](errors.md)
- [Webhook 指南](webhooks.md)
- [JavaScript SDK](sdk-javascript.md) · [Python SDK](sdk-python.md) · [Go SDK](sdk-go.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版（依据 OpenAPI 规范与 SDK 源码核对） |
