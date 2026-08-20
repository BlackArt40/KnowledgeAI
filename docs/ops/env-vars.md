---
title: 环境变量全表
description: KnowledgeAI 全部环境变量参考：必填项、默认值、演示回退行为与配置说明（单一事实源 .env.example）
type: reference
category: ops
level: L2
version: 1.0.0
authors: [technical-writer]
owner: devops-owner
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [deployment-guide.md, monitoring.md]
---

# 环境变量全表

> **单一事实源**：本文档与仓库根 `.env.example` 保持一致。配置项变更时须同步更新两处；CI 会校验 `docs/ops/env-vars.md` 与 `.env.example` 的变量名集合一致（覆盖率指标：环境变量覆盖率 100%）。
>
> **核心原则**：留空的项自动回退演示模式。复制 `.env.example` 为 `.env.local`（本地）或 `.env`（服务器）后按需填写。

## 应用

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `NEXT_PUBLIC_APP_NAME` | 否 | `KnowledgeAI` | 应用显示名 |
| `NEXT_PUBLIC_APP_URL` | 否 | `http://localhost:3000` | 对外基础 URL |

## 数据库

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `DATABASE_URL` | 否 | 空（内存模式） | PostgreSQL 连接串。配置后：启动水合内存 + 写入持久化；留空 = 纯内存演示（重启即失） |

启用步骤：准备 PG → 填连接串 → `npx prisma migrate deploy` →（可选）`npx prisma db seed`。

## 认证与安全

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `AUTH_SECRET` | **是（生产）** | `change-me-...` | JWT 签名密钥，**生产必须改为随机 32+ 字符**；同时作为审计链 HMAC 密钥 |
| `AUDIT_RETENTION_DAYS` | 否 | `90` | 审计日志保留天数 |
| `AUDIT_MAX_ENTRIES` | 否 | `2000` | 内存审计链上限 |

## OAuth 社交登录（Auth.js v5）

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 否 | 空 | 启用 Google 登录（未配置则按钮隐藏） |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 否 | 空 | 启用 GitHub 登录 |
| `AUTH_URL` | 反代后建议 | 请求 Host | Auth.js baseUrl；回调：`{AUTH_URL}/api/auth/callback/{google\|github}` |
| `GOOGLE_ISSUER` / `GITHUB_ISSUER` | 否 | 空 | 自定义 OIDC issuer（测试/自托管代理用） |

## 可观测性与日志

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `SENTRY_DSN` | 否 | 空 | 设置后前后端错误经 Envelope 协议直投 Sentry；未设置 = 仅内存 ring + 管理端面板 |
| `LOG_LEVEL` | 否 | `info` | pino 日志级别：debug / info / warn / error |
| `LOG_LOKI_URL` | 否 | 空 | 设置后批量推送 Loki（`/loki/api/v1/push`）；未设置 = 仅 stdout JSON |
| `LOG_REDACT_KEYS` | 否 | 空 | 额外脱敏字段（逗号分隔 pino redact 路径，追加到内置敏感键表） |

## LLM 与嵌入

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `OPENAI_API_KEY` | 否 | 空 | 留空 = 本地哈希嵌入 + 抽取式生成（演示） |
| `OPENAI_BASE_URL` | 否 | `https://api.openai.com/v1` | 兼容 OpenAI 协议的服务（DeepSeek / Moonshot / 硅基流动 等） |
| `EMBEDDING_MODEL` | 否 | `text-embedding-3-small` | 嵌入模型 |
| `CHAT_MODEL` | 否 | `gpt-4o` | 对话模型 |

## 向量库

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `VECTOR_STORE` | 否 | `memory` | `memory` / `pgvector` / `chromadb` / `pinecone` |
| `CHROMA_URL` | 条件 | — | 仅 `chromadb` 时使用 |
| `PINECONE_API_KEY` / `PINECONE_INDEX_HOST` | 条件 | — | 仅 `pinecone` 时使用 |

> `pgvector` 需先在 PG 执行 `CREATE EXTENSION vector;`。

## 对象存储

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `S3_ENDPOINT` | 否 | 空（本地 `.uploads/`） | S3 / MinIO / R2 端点 |
| `S3_BUCKET` | 否 | `knowledgeai-uploads` | 存储桶 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | 否 | 空 | 访问密钥 |

## 限流（分级维度）

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `REDIS_URL` | 否 | 空（内存窗口） | 设置后启用 Redis 滑动窗口（多实例全局限流） |
| `RATE_LIMIT_PER_MIN` | 否 | `200` | 登录用户（次/分） |
| `RATE_LIMIT_ANON_PER_MIN` | 否 | `20` | 匿名 IP |
| `RATE_LIMIT_KEY_PER_MIN` | 否 | `500` | API Key |
| `RATE_LIMIT_KB_PER_MIN` | 否 | `60` | 知识库维度（聊天/加载，须低于用户档位） |
| `RATE_LIMIT_INTEGRATION_PER_MIN` | 否 | `120` | 集成（机器人）维度 |

## 支付

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `STRIPE_SECRET_KEY` | 否 | 空（模拟支付） | Stripe 密钥 |
| `STRIPE_WEBHOOK_SECRET` | 否 | 空 | Webhook 校验密钥 |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ENT` | 条件 | — | 专业版 / 企业版 Price ID |

## 系统配置

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `MAINTENANCE_MODE` | 否 | `false` | 维护模式开关 |
| `ALLOW_SIGNUP` | 否 | `true` | 允许注册 |

## OCR（扫描件 / 图片文字识别）

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `OCR_ENABLED` | 否 | `true` | 总开关；`false` 跳过全部 OCR（纯数字文档快速路径） |
| `OCR_LANG` | 否 | `eng+chi_sim` | Tesseract 语言包（`+` 连接，CJK + 英文默认） |
| `OCR_MAX_PAGES` | 否 | `20` | 每份扫描 PDF 的 OCR 页数上限（约束 worker 耗时） |

## RAG 增强（重排 + 查询改写）

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `RERANK_ENABLED` | 否 | `true` | LLM 重排；需 LLM Provider，未配置自动 no-op |
| `RERANK_CANDIDATES` | 否 | `20` | 重排候选池大小 |
| `QUERY_REWRITE_ENABLED` | 否 | `true` | LLM 多查询改写（同义词扩展） |
| `QUERY_REWRITE_COUNT` | 否 | `3` | 改写查询数 |

## 智能切片

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `PARENT_CHILD_CHUNKING` | 否 | `false` | 父子切片：小片段检索 + 大片段生成上下文 |

## 外部数据源（Web 搜索 / ArXiv / GitHub）

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `TAVILY_API_KEY` | 否 | 空（模拟结果） | Tavily（RAG 最佳，返回干净内容） |
| `SERPAPI_KEY` | 否 | 空 | SerpAPI（Google 结果） |
| `BRAVE_SEARCH_KEY` | 否 | 空 | Brave Search |
| `GITHUB_TOKEN` | 否 | 空 | GitHub（提高限额；ArXiv 免费） |

> 所有外部数据源均有演示回退（未配置返回模拟结果）。

## 文档同步（Notion / Confluence）

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `NOTION_TOKEN` | 否 | 空 | Notion 集成 Token（也可在请求体传 token 覆盖） |
| `NOTION_API_URL` | 否 | 空 | 测试/代理覆写 |
| `CONFLUENCE_BASE_URL` | 否 | 空 | Confluence Cloud 站点地址 |
| `CONFLUENCE_EMAIL` / `CONFLUENCE_TOKEN` | 否 | 空 | PAT（Basic auth = `EMAIL:TOKEN`） |

## 相关文档

- [部署指南](deployment-guide.md)
- [监控与告警](monitoring.md)
- [Provider 状态聚合（管理端面板）](../../src/lib/config.ts)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版（与 .env.example 逐项核对） |
