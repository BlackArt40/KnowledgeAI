---
title: 常见问题 FAQ
description: KnowledgeAI 高频问题汇总：环境配置、部署运维、数据库、API 鉴权、性能限流与功能使用
type: reference
category: faq
level: L1
version: 1.0.0
authors: [technical-writer]
owner: 技术文档负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [troubleshooting.md, ../ops/deployment-guide.md, ../ops/env-vars.md, ../api/guide.md]
---

# 常见问题 FAQ

> 本文按模块沉淀高频问题，内容来源于仓库文档、已知约定与常见误区。**维护机制**：新问题出现后，先在本表登记，确认根因后补入[故障排查](troubleshooting.md)（四段式）。带 ⚠️ 的是新手最容易踩的坑。

## 环境与运行模式

### 不配置 DATABASE_URL 会怎样？

纯内存演示模式：数据存在 `globalThis`，**重启即失**、无法多实例。这是设计行为（配置即切换），不是故障。需要持久化就配置 `DATABASE_URL` 并执行 `npx prisma migrate deploy`。

### 如何从演示模式切到生产模式？

1. 填 `DATABASE_URL` → 2. `npx prisma migrate deploy`（建表）→ 3.（可选）`npx prisma db seed` → 4. 重启。已配置的 Provider 自动激活，管理端 `/admin` 可查看各 Provider 状态。反过来移除 `DATABASE_URL` 即回退演示模式。

### 容器内连接数据库为什么失败？⚠️

容器里的 `localhost` 是容器自己，不是宿主机。Docker Compose 部署时必须用服务名（如 `postgres`、`redis`），外部数据库用真实地址：`DATABASE_URL=postgresql://user:pwd@db-host:5432/knowledgeai`。

## 部署与运维

### worker 服务是干什么的？必须部署吗？⚠️

worker 消费后台队列（文档处理 / Agent 调研 / 索引清理）。**不部署 worker，文档会一直处于处理中、Agent 任务永不执行**——app 只往队列写，不消费。K8s / compose 中 worker 用同一镜像、命令覆盖为 `node worker.js`。

### app 与 worker 为什么必须共享上传目录？

文档处理在 worker 里执行，需要读取 app 写入的上传文件。compose 用命名卷 `uploads` 挂到两边的 `/app/.uploads`；K8s 用 PVC。不共享会出现「文档找不到 / 处理失败」。

### 部署后上传报 EACCES 权限错误？

镜像以非 root 用户 `nextjs`（uid 1001）运行，上传目录需可写：
- compose：命名卷首次挂载自动继承目录属主（Dockerfile 已 `chown`）；
- K8s：`securityContext.fsGroup: 1001` 让 PVC 可写。

### 如何回滚一次生产部署？

重新触发 `deploy-prod.yml` 工作流并指定**上一个镜像 tag**，蓝绿脚本会自动回滚失败的切换；成功切换后旧容器以 `GREEN-old` 保留，也可手动接管。

## 数据库

### 修改 prisma/schema.prisma 后要做什么？

`npx prisma migrate dev --name <描述>` 生成迁移（CI 会校验 schema 与迁移无漂移：`prisma migrate diff --exit-code`）。**不要跳过迁移直接改库**，CI 会失败。

### pgvector 检索报错 / 向量扩展缺失？

`VECTOR_STORE=pgvector` 前必须先在 PostgreSQL 执行 `CREATE EXTENSION vector;`（compose 用 `pgvector/pgvector:pg16` 镜像自带扩展支持）。

### 如何把内存索引迁移到向量库？

用 `scripts/migrate-vector-store.ts`（`npx tsx` 运行）将现有内存索引批量导入目标后端，然后切 `VECTOR_STORE` 环境变量。

## 认证与 API

### API Key 在哪里创建？创建后丢了怎么办？

「设置 → API 密钥」创建，格式 `kai_sk_...`，创建时选择 scope。**密钥仅创建时展示一次**，丢失只能删除重建。JWT 会话调用 v1 不受 scope 限制（走 RBAC）。

### 调用 v1 API 报 403「缺少 scope」？

API Key 创建时分配的 scope 与端点不匹配。对照[端点 Scope 表](../api/reference.md)检查：`kb:read` / `kb:write` / `chat:read` / `agent:run`。JWT 会话不受限。

### OAuth 登录按钮不显示？

未配置 `GOOGLE_CLIENT_ID` / `GITHUB_CLIENT_ID` 时按钮自动隐藏。配置后回调地址为 `{AUTH_URL}/api/auth/callback/{google|github}`，反向代理部署需显式设置 `AUTH_URL`。

## 性能与限流

### 收到 429 怎么办？

读取响应体的 `retryAfter`（秒）与 `dimension`（限流维度），按指数退避重试（上限 60s）。档位对应环境变量：API Key `RATE_LIMIT_KEY_PER_MIN`（默认 500）、用户 `RATE_LIMIT_PER_MIN`、匿名 `RATE_LIMIT_ANON_PER_MIN`（20）、KB `RATE_LIMIT_KB_PER_MIN`（60）。SSE 流式端点已豁免。

### 为什么答非所问 / 检索质量差？

排查顺序：① 文档是否处理完成（`kb.ready`）；② `RAG_SETTINGS` 的 `topK` 是否过小；③ 是否配置了真实 LLM（演示模式用本地抽取式生成，质量有限）；④ 可开启 `RERANK_ENABLED` / `QUERY_REWRITE_ENABLED`（需 LLM Provider）；⑤ 尝试开启 `PARENT_CHILD_CHUNKING`。

## 功能使用

### 图片/扫描件识别（OCR）如何开启？

默认开启（`OCR_ENABLED=true`）。扫描 PDF（无文本层）与图片上传会自动走 tesseract.js OCR；`OCR_LANG` 默认 `eng+chi_sim`；`OCR_MAX_PAGES` 限制单份扫描 PDF 的 OCR 页数（20），超长文档建议拆分。

### 聊天「联网搜索」需要什么配置？

配置任一搜索服务 Key（`TAVILY_API_KEY` / `SERPAPI_KEY` / `BRAVE_SEARCH_KEY`）即可；未配置时返回模拟结果（演示）。Agent 调研还可选配 `GITHUB_TOKEN`（ArXiv 免费）。

### 多实例部署有什么限制？

读路径走各实例内存（见 [ADR-0001](../architecture/adr/adr-0001-in-memory-store-write-through-db.md)），多实例共享读需演进缓存层；限流与队列配置 `REDIS_URL` 后可跨实例生效。

## 开发与 CI

### 本地提交前必须过哪些检查？

`pnpm lint`（零告警）+ `pnpm test:unit`（覆盖率门槛：lines/functions/statements 70%、branches 60%）。CI 四 job：quality（tsc + lint + build + prisma drift）、unit、integration、e2e。

### 改了 src/lib/ 下代码，文档要同步吗？

要。文档体系约定：**文档随代码走同一 PR**（docs-as-code）。改 `src/lib/` 模块、导出 API 或 schema 时，同步更新 `docs/architecture/`、`docs/api/` 对应文档；CI 的 `docs-check`（规划中）会校验 API 漂移与死链。

## 相关文档

- [故障排查（四段式）](troubleshooting.md)
- [部署指南](../ops/deployment-guide.md) · [环境变量全表](../ops/env-vars.md) · [监控与告警](../ops/monitoring.md)
- [API 使用指南](../api/guide.md) · [错误码表](../api/errors.md)
- [术语表](../standards/glossary.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版（依据仓库约定与已知坑位沉淀） |
