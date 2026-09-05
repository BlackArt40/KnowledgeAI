---
title: 环境变量全表
description: KnowledgeAI 全部环境变量参考：必填项、默认值、演示回退行为与配置说明（单一事实源 .env.example）
type: reference
category: ops
level: L2
version: 1.1.0
authors: [technical-writer]
owner: devops-owner
reviewed_at: 2026-09-05
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [deployment-guide.md, monitoring.md]
---

# 环境变量全表

> **单一事实源**：本文档与仓库根 `.env.example` 保持一致。配置项变更时须同步更新两处；CI 通过 `scripts/tools/check-env-parity.ts` 校验两者的变量名集合一致（不一致即门禁失败）。
>
> **核心原则**：留空的项自动回退演示模式。复制 `.env.example` 为 `.env.local`（本地）或 `.env`（服务器）后按需填写。

## 应用

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `NEXT_PUBLIC_APP_URL` | 否 | `http://localhost:3000` | 对外基础 URL（也是密码重置/邮箱验证邮件链接的 base） |

> 历史变量 `NEXT_PUBLIC_APP_NAME` 已废弃：应用显示名现在由管理后台系统设置维护。

## 数据库

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `DATABASE_URL` | 否 | 空（内存模式） | PostgreSQL 连接串。配置后：启动水合内存 + 写入持久化；留空 = 纯内存演示（重启即失） |

启用步骤：准备 PG → 填连接串 → `npx prisma migrate deploy` →（可选）`npx prisma db seed`。

## 认证与安全

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `AUTH_SECRET` | **是（生产）** | `change-me-...` | JWT 签名密钥，**生产必须改为随机 32+ 字符**（未配置生产拒绝启动）；同时作为审计链 HMAC 密钥 |
| `AUDIT_RETENTION_DAYS` | 否 | `90` | 审计日志保留天数 |
| `AUDIT_MAX_ENTRIES` | 否 | `2000` | 内存审计链上限 |

## 邮件（P8 密码重置 / 邮箱验证）

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `RESEND_API_KEY` | 否 | 空（演示回退） | Resend API Key；配置后密码重置/邮箱验证经后台队列异步投递（固定投递到 Resend 云端 API）。未配置 = 演示模式，重置链接直接返回在响应 body（仅本地开发，生产统一响应防枚举） |
| `EMAIL_FROM` | 与上方成对 | 空 | 发件地址，如 `KnowledgeAI <noreply@yourdomain.com>` |

## API CORS（P7-2 公共 API）

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `CORS_ALLOWED_ORIGINS` | 否 | 空（反射任意 Origin） | `/api/*` 的 Origin 白名单（逗号分隔完整 origin）。响应始终带 `Vary: Origin` 防共享缓存投毒；生产建议显式设置 |

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
| `S3_REGION` | 否 | `us-east-1` | 区域 |
| `S3_PUBLIC_URL` | 否 | 空 | 公开访问的 CDN/基础 URL（可选） |
| `MAX_UPLOAD_MB` | 否 | `50` | 单文件大小上限（MB） |
| `CHUNK_SIZE_MB` | 否 | `5` | 分片上传单片大小（MB） |
| `MAX_CHUNKED_UPLOAD_MB` | 否 | `500` | 分片上传文件总量上限（MB） |

## 限流（分级维度）

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `REDIS_URL` | 否 | 空（内存窗口） | 设置后启用 Redis 滑动窗口（多实例全局限流） |
| `RATE_LIMIT_PER_MIN` | 否 | `200` | 登录用户（次/分） |
| `RATE_LIMIT_ANON_PER_MIN` | 否 | `20` | 匿名 IP |
| `RATE_LIMIT_KEY_PER_MIN` | 否 | `500` | API Key |
| `RATE_LIMIT_KB_PER_MIN` | 否 | `60` | 知识库维度（聊天/加载，须低于用户档位） |
| `RATE_LIMIT_INTEGRATION_PER_MIN` | 否 | `120` | 集成（机器人）维度 |
| `RATE_LIMIT_AGENT_PER_MIN` | 否 | `10` | Agent 运行维度（P1-2：`/api/agent/run` 是高成本多步 LLM 任务，独立于用户配额） |
| `RATE_LIMIT_AUTH_EMAIL_PER_MIN` | 否 | `3` | 触发外发邮件的未认证端点（P8：忘记密码/验证邮件重发），按 邮箱+端点 键控防邮件轰炸 |

## 支付

| 变量 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `STRIPE_SECRET_KEY` | 否 | 空（模拟支付） | Stripe 密钥 |
| `STRIPE_WEBHOOK_SECRET` | 否 | 空 | Webhook 校验密钥 |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ENT` | 条件 | — | 专业版 / 企业版 Price ID |

## 系统配置

> 维护模式与注册开关已迁移到管理后台（`/admin` 系统设置，DB 持久化、运行时生效），不再通过环境变量配置。历史变量 `MAINTENANCE_MODE` / `ALLOW_SIGNUP` 已废弃。

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
| 1.1.0 | 2026-09-05 | 补 P8 邮件（RESEND/EMAIL_FROM）、AGENT/AUTH_EMAIL 限流档、CORS、S3_REGION/S3_PUBLIC_URL、MAX_UPLOAD_MB；移除废弃的 NEXT_PUBLIC_APP_NAME/MAINTENANCE_MODE/ALLOW_SIGNUP；新增 CI 变量名一致性校验 |
| 1.0.0 | 2026-08-20 | 初版（与 .env.example 逐项核对） |
