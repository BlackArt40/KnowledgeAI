---
title: API 参考
description: KnowledgeAI v1 公开 API 端点总表，由 OpenAPI 3.0.3 规范自动生成，禁止手写
type: reference
category: api
level: L2
version: 1.0.0
authors: [openapi-gen]
owner: api-owner
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [guide.md, errors.md, webhooks.md]
---

# API 参考

> **自动生成文档**：本文由 `scripts/tools/gen-api-reference.ts` 从 [OpenAPI 3.0.3 规范](../../src/lib/openapi/spec.ts)生成（首次生成 2026-08-20，复审更新 reviewed_at）。**禁止手写修改正文**；API 变更后运行 `npx tsx scripts/tools/gen-api-reference.ts` 重新生成。
>
> 交互式文档：启动服务后访问 `/docs`（Swagger UI）；原始规范：`GET /api/openapi.json`。
> 使用指南（鉴权 / 限流 / 错误处理 / 调用示例）见 [API 使用指南](guide.md)。

## 端点总表（7 组，均为 `/api/v1` 前缀下的公开表面）

| 方法 | 路径 | 摘要 | 鉴权 | Scope | 流式 |
|------|------|------|------|-------|------|

### Account

| 方法 | 路径 | 摘要 | Scope | 成功 | 错误 |
|------|------|------|-------|------|------|
| `GET` | `/api/v1/me` | 当前用户信息 | — | 200 | 401 |

### Knowledge Bases

| 方法 | 路径 | 摘要 | Scope | 成功 | 错误 |
|------|------|------|-------|------|------|
| `GET` | `/api/v1/knowledge-bases` | 知识库列表 | `kb:read` | 200 | 401 / 403 |
| `POST` | `/api/v1/knowledge-bases` | 创建知识库 | `kb:write` | 201 | 400 / 401 / 403 |

### Chat

| 方法 | 路径 | 摘要 | Scope | 成功 | 错误 |
|------|------|------|-------|------|------|
| `POST` | `/api/v1/chat` | 流式智能问答（SSE） | `chat:read` | 200 | 400 / 401 / 403 / 404 / 429 |

### Agent

| 方法 | 路径 | 摘要 | Scope | 成功 | 错误 |
|------|------|------|-------|------|------|
| `POST` | `/api/v1/agent/run` | Agent 调研（SSE） | `agent:run` | 200 | 400 / 401 / 403 |

### Webhooks

| 方法 | 路径 | 摘要 | Scope | 成功 | 错误 |
|------|------|------|-------|------|------|
| `GET` | `/api/v1/webhooks` | Webhook 订阅列表 | — | 200 | 401 |
| `POST` | `/api/v1/webhooks` | 创建 Webhook 订阅 | — | 201 | 400 / 401 |
| `GET` | `/api/v1/webhooks/{id}` | Webhook 订阅详情 | — | 200 | 401 / 404 |
| `PATCH` | `/api/v1/webhooks/{id}` | 更新 Webhook 订阅 | — | 200 | 400 / 401 / 404 |
| `DELETE` | `/api/v1/webhooks/{id}` | 删除 Webhook 订阅 | — | 200 | 401 / 404 |
| `POST` | `/api/v1/webhooks/{id}/test` | 发送测试事件 | — | 200 | 401 / 404 |

## 认证方式

所有端点要求 `Authorization: Bearer <API_KEY>`（API Key，前缀 `kai_sk_`）或登录会话 JWT。API Key 按 scope 强制校验，缺少所需 scope 返回 403。详见 [API 使用指南 → 鉴权](guide.md#鉴权)。

## 数据模型

| Schema | 说明 |
|--------|------|
| `Error` | 见 `/api/openapi.json` 中 `#/components/schemas/Error` |
| `MeResponse` | 见 `/api/openapi.json` 中 `#/components/schemas/MeResponse` |
| `CreateKbRequest` | 见 `/api/openapi.json` 中 `#/components/schemas/CreateKbRequest` |
| `KbStats` | 见 `/api/openapi.json` 中 `#/components/schemas/KbStats` |
| `KbResponse` | 见 `/api/openapi.json` 中 `#/components/schemas/KbResponse` |
| `KbListResponse` | 见 `/api/openapi.json` 中 `#/components/schemas/KbListResponse` |
| `ChatRequest` | 见 `/api/openapi.json` 中 `#/components/schemas/ChatRequest` |
| `AgentRunRequest` | 见 `/api/openapi.json` 中 `#/components/schemas/AgentRunRequest` |
| `CreateWebhookRequest` | 见 `/api/openapi.json` 中 `#/components/schemas/CreateWebhookRequest` |
| `UpdateWebhookRequest` | 见 `/api/openapi.json` 中 `#/components/schemas/UpdateWebhookRequest` |
| `WebhookResponse` | 见 `/api/openapi.json` 中 `#/components/schemas/WebhookResponse` |
| `WebhookListResponse` | 见 `/api/openapi.json` 中 `#/components/schemas/WebhookListResponse` |

> 完整字段定义以 OpenAPI 规范为准（`GET /api/openapi.json` 或 `/docs` Swagger UI）。

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 由 OpenAPI 规范自动生成 |
