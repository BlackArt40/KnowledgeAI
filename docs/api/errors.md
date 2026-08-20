---
title: 错误码表
description: KnowledgeAI API 错误响应结构与状态码说明，含 429 限流处理规范
type: reference
category: api
level: L2
version: 1.0.0
authors: [technical-writer]
owner: api-owner
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [guide.md, reference.md]
---

# 错误码表

> 本文定义 KnowledgeAI API 的错误响应结构与状态码语义。调用前请先阅读 [API 使用指南](guide.md)。

## 响应结构

所有错误响应为 `application/json`：

```json
{
  "error": "人类可读的错误信息",
  "retryAfter": 30,
  "dimension": "user"
}
```

| 字段 | 类型 | 必现 | 说明 |
|------|------|:----:|------|
| `error` | string | ✅ | 人类可读错误信息 |
| `retryAfter` | number | 仅 429 | 建议重试秒数 |
| `dimension` | string | 仅 429 | 限流维度：`ip` / `user` / `apikey` / `kb` |

## 状态码总表

| 状态码 | 语义 | 典型场景 | 处理建议 |
|--------|------|----------|----------|
| `200` | 成功 | 普通响应 / SSE 流 | — |
| `201` | 创建成功 | 创建知识库 / Webhook 订阅 | — |
| `400` | 请求参数错误 | 缺少必填字段、非法 JSON、校验失败 | 检查请求体与字段约束 |
| `401` | 未认证 / 凭据无效 | 无 Authorization、密钥无效、会话过期 | 检查 API Key 与有效期 |
| `403` | 无权限 | API Key 缺少所需 scope、RBAC 拒绝 | 在「设置 → API 密钥」补充 scope |
| `404` | 资源不存在 | 知识库 / 订阅 ID 错误 | 核对 ID 与所属工作区 |
| `429` | 触发限流 | 超出维度配额 | 按 `retryAfter` 退避重试（见下） |
| `500` | 服务端错误 | 内部异常 | 携带 `X-Trace-Id` 反馈 |

## 限流错误（429）详解

限流按身份分级执行（一次请求只取一个维度），被限流时响应：

```json
{
  "error": "请求过于频繁，请稍后再试",
  "retryAfter": 30,
  "dimension": "apikey"
}
```

| dimension | 含义 | 默认配额 |
|-----------|------|----------|
| `ip` | 匿名 IP | 20 次/分 |
| `user` | 登录用户 | 可配置（`RATE_LIMIT_PER_MIN`） |
| `apikey` | API Key | 500 次/分（`RATE_LIMIT_KEY_PER_MIN`） |
| `kb` | 知识库维度（聊天/加载） | 60 次/分（`RATE_LIMIT_KB_PER_MIN`） |

**退避策略**：`sleep(retryAfter)` 后重试；并发突发时指数退避（上限 60s）。SSE 流式端点（`/api/v1/chat`、`/api/v1/agent/run`）已豁免限流，无需处理 429。

## Scope 错误（403）

API Key 调用 v1 端点但缺少所需 scope 时返回 403，`error` 字段会说明所需 scope。各端点所需 scope 见 [API 参考](reference.md) 的 Scope 列。JWT 会话调用不受 scope 限制（走 RBAC）。

## 相关文档

- [API 使用指南](guide.md)
- [API 参考](reference.md)
- [Webhook 指南](webhooks.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版 |
