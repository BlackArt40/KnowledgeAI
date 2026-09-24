---
title: 常见问题与故障排查
description: KnowledgeAI 高频问题与故障排查：环境配置、部署运维、数据库、API 鉴权、性能限流、功能使用与四段式排障手册
type: reference
category: faq
level: L1
version: 1.1.0
authors: [technical-writer]
owner: 技术文档负责人
reviewed_at: 2026-09-23
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [../ops/deployment-guide.md, ../ops/env-vars.md, ../ops/monitoring.md, ../api/guide.md, ../api/errors.md]
---

# 常见问题与故障排查

> 本文分两部分：**上半部分**是高频问答（按模块分类），**下半部分**是[四段式故障排查手册](#troubleshooting)（症状 → 原因 → 处理 → 预防）。新问题先在问答区登记，确认根因后补入排障手册。带 ⚠️ 的是新手最容易踩的坑。

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

读取响应体的 `retryAfter`（秒）与 `dimension`（限流维度），按指数退避重试（上限 60s）。档位对应环境变量：匿名 `RATE_LIMIT_ANON_PER_MIN`（20）、用户 `RATE_LIMIT_PER_MIN`（200）、API Key `RATE_LIMIT_KEY_PER_MIN`（500）、KB `RATE_LIMIT_KB_PER_MIN`（60）、第三方集成 `RATE_LIMIT_INTEGRATION_PER_MIN`（120）、Agent `RATE_LIMIT_AGENT_PER_MIN`（10）、认证邮件 `RATE_LIMIT_AUTH_EMAIL_PER_MIN`（3）。SSE 流式端点已豁免。

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

`pnpm lint`（零告警）+ `pnpm test:unit`（覆盖率门槛：lines/functions/statements 70%、branches 60%）。CI 五 job：quality（tsc + lint + build + prisma drift）、unit、integration、e2e、docs（文档构建死链检查 + Frontmatter 校验 + API 参考漂移 + 环境变量一致性）。

### 改了 src/lib/ 下代码，文档要同步吗？

要。文档体系约定：**文档随代码走同一 PR**（docs-as-code）。改 `src/lib/` 模块、导出 API 或 schema 时，同步更新 `docs/architecture/`、`docs/api/` 对应文档；CI 的 `docs` job 会校验 API 漂移、死链、Frontmatter 与环境变量文档一致性。

## 故障排查手册 {#troubleshooting}

> 按「症状 → 原因 → 处理 → 预防」四段式组织。**新增条目规范**：先确认根因与可复现步骤，再按本格式补充，防止条目失真。

### 1. 就绪探针 503 degraded

**症状**：`GET /api/health/ready` 返回 503，响应 `degraded` 列表非空；K8s 下实例被摘流量。

**原因**：DB / Redis / LLM 至少一项已配置但不可达（未配置的依赖计 `skipped`，不会触发）。

**处理**：
1. 读响应 `checks` 逐项定位故障依赖；
2. 验证连通性：DB `SELECT 1`、Redis `redis-cli ping`、LLM `GET /models`（OpenAI 兼容）；
3. 检查网络（容器内 `localhost` 陷阱见下）与凭据是否过期；
4. 修复后探针自动恢复（`ok→degraded` 已告警、恢复自动通知）。

**预防**：依赖就绪后启动应用；K8s 用 `startupProbe` 容错首次启动。

### 2. 容器内连接数据库失败（Connection refused / ECONNREFUSED）

**症状**：启动日志报连接 `postgres:5432` 或 `redis` 失败；`/api/health/ready` 的 db/redis 项 degraded。

**原因**：⚠️ 容器内 `localhost` 指向容器自身。误把宿主机地址写成 `localhost`，或 `DATABASE_URL` 端口与 compose 暴露端口（宿主机 `5432`）混淆。

**处理**：
1. compose 内用服务名：`postgresql://user:pwd@postgres:5432/knowledgeai`、`redis://redis:6379/0`；
2. 外部数据库用真实主机地址，不要用 `localhost`。

**预防**：环境变量模板按 compose 服务名填写；生产环境由 `.env` 注入。

### 3. 文档一直「处理中」/ Agent 任务永不完成

**症状**：上传文档后状态长时间不更新；`/api/agent/run` 入队后无进度事件。

**原因**：**worker 未部署或未消费队列**（app 只写不读）；或 `REDIS_URL` 未配置但期望多实例队列。

**处理**：
1. 确认 worker 进程运行（compose：`docker compose ps` 看 worker 服务；K8s：worker Deployment 副本数 > 0）；
2. 内存模式下 worker 与 app 同进程（`instrumentation-node.ts` 启动），确认未误禁用；
3. 检查队列积压：Redis 模式下 `LLEN bull:*:wait` 等队列键。

**预防**：部署自检清单勾选「worker 已部署」（见[部署指南](../ops/deployment-guide.md)）。

### 4. 上传/写入 EACCES 权限错误

**症状**：上传文档失败，日志报 `EACCES: permission denied` 写入 `/app/.uploads`。

**原因**：镜像以非 root `nextjs`（uid 1001）运行，上传卷不可写（卷首次挂载属主不匹配，或 K8s PVC 无 fsGroup）。

**处理**：
- Docker：确认使用命名卷（Dockerfile 已对 `/app/.uploads` `chown nextjs:nodejs`）；
- K8s：`securityContext.fsGroup: 1001`；
- 排查：`kubectl exec <pod> -- ls -ld /app/.uploads` 检查属主。

**预防**：使用 compose 默认卷配置；K8s 清单勿删 fsGroup。

### 5. API 请求 429 限流

**症状**：接口返回 429，响应含 `retryAfter` / `dimension`。

**原因**：命中限流维度配额（匿名 20 / 用户可配 / API Key 500 / KB 60，次/分）。

**处理**：
1. 读 `dimension` 定位维度，按 `retryAfter` 退避重试；
2. 高频集成检查是否误用匿名身份（应配 API Key，额度 500）；
3. 压测/演示场景按需调高档位环境变量（如 `RATE_LIMIT_PER_MIN=2000`）。

**预防**：生产监控 429 比例；SSE 端点已豁免无需处理。

### 6. v1 API 返回 403「缺少 scope」

**症状**：`/api/v1/*` 调用返回 403。

**原因**：API Key 的 scope 与端点要求不匹配（如 `chat:read` 密钥调 `POST /knowledge-bases` 需 `kb:write`）。

**处理**：重建密钥并勾选所需 scope；或用登录 JWT 会话调用（不受 scope 限制）。

**预防**：对照[端点 Scope 表](../api/reference.md)规划密钥 scope。

### 7. 向量检索失败 / 查不到结果

**症状**：问答引用为空或检索报错；切换 `pgvector` 后索引失败。

**原因**：`pgvector` 未创建 `vector` 扩展；或索引未迁移（内存索引未导入新后端）。

**处理**：
1. `CREATE EXTENSION IF NOT EXISTS vector;`；
2. `npx tsx scripts/migrate-vector-store.ts` 迁移存量索引；
3. 确认 `VECTOR_STORE` 与索引实际所在后端一致。

**预防**：切换后端先迁移再切环境变量；compose 用 `pgvector/pgvector` 镜像。

### 8. OCR 失败 / 扫描件识别为空

**症状**：扫描 PDF / 图片上传后无文本可检索。

**原因**：`OCR_ENABLED=false`；语言包缺失（`OCR_LANG` 需匹配文档语言，默认 `eng+chi_sim`）；超长文档超 `OCR_MAX_PAGES`（默认 20）。

**处理**：确认 OCR 开关与语言包；超长文档拆分上传；检查 `.tessdata/` 语言包就绪（首次自动下载）。

**预防**：混合语言文档显式配置 `OCR_LANG`。

### 9. CI 失败：prisma 迁移漂移

**症状**：CI `quality` job 的 `prisma migrate diff --exit-code` 失败。

**原因**：改了 `prisma/schema.prisma` 但未生成迁移，或迁移与 schema 不一致。

**处理**：`npx prisma migrate dev --name <描述>` 生成迁移并提交；不要手工改库。

**预防**：schema 变更流程见[开发规范](../standards/README.md)；PR 模板勾选「DB 迁移」项。

### 10. 问答质量差 / 答非所问

**症状**：回答与问题无关或引用错误。

**原因**：演示模式（本地抽取式生成）；`topK` 过小；文档未处理完成；重排/改写未开启。

**处理**：配置真实 LLM；检查 `kb.ready`；调大 `topK`；开启 `RERANK_ENABLED` / `QUERY_REWRITE_ENABLED`；对已上线文档使用「点赞/点踩」反馈降权纠偏。

**预防**：上线前用真实 Provider 验证检索质量（`RERANK_CANDIDATES` 默认 20 候选池）。

### 新增条目模板

```markdown
### N. <故障标题>

**症状**：<可观察现象，含报错信息>

**原因**：<根因，1-2 句>

**处理**：<按顺序的排查/修复步骤>

**预防**：<如何避免再次发生>
```

## 相关文档

- [部署指南](../ops/deployment-guide.md) · [环境变量全表](../ops/env-vars.md) · [监控与告警](../ops/monitoring.md)
- [API 使用指南](../api/guide.md) · [错误码表](../api/errors.md)
- [术语表](../standards/glossary.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.1.0 | 2026-09-23 | 合并原《故障排查手册》为下半部分；429 限流维度补全为 7 档 |
| 1.0.0 | 2026-08-20 | 初版（依据仓库约定与已知坑位沉淀） |
