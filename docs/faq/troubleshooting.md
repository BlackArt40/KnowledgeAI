---
title: 故障排查手册
description: KnowledgeAI 常见故障四段式排查：症状、原因、处理步骤与预防措施
type: how-to
category: faq
level: L1
version: 1.0.0
authors: [technical-writer]
owner: 技术文档负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [faq.md, ../ops/monitoring.md, ../ops/deployment-guide.md]
---

# 故障排查手册

> 按「症状 → 原因 → 处理 → 预防」四段式组织。**新增条目规范**：先确认根因与可复现步骤，再按本格式补充，防止条目失真。

## 1. 就绪探针 503 degraded

**症状**：`GET /api/health/ready` 返回 503，响应 `degraded` 列表非空；K8s 下实例被摘流量。

**原因**：DB / Redis / LLM 至少一项已配置但不可达（未配置的依赖计 `skipped`，不会触发）。

**处理**：
1. 读响应 `checks` 逐项定位故障依赖；
2. 验证连通性：DB `SELECT 1`、Redis `redis-cli ping`、LLM `GET /models`（OpenAI 兼容）；
3. 检查网络（容器内 `localhost` 陷阱见下）与凭据是否过期；
4. 修复后探针自动恢复（`ok→degraded` 已告警、恢复自动通知）。

**预防**：依赖就绪后启动应用；K8s 用 `startupProbe` 容错首次启动。

## 2. 容器内连接数据库失败（Connection refused / ECONNREFUSED）

**症状**：启动日志报连接 `postgres:5432` 或 `redis` 失败；`/api/health/ready` 的 db/redis 项 degraded。

**原因**：⚠️ 容器内 `localhost` 指向容器自身。误把宿主机地址写成 `localhost`，或 `DATABASE_URL` 端口与 compose 暴露端口（宿主机 `5432`）混淆。

**处理**：
1. compose 内用服务名：`postgresql://user:pwd@postgres:5432/knowledgeai`、`redis://redis:6379/0`；
2. 外部数据库用真实主机地址，不要用 `localhost`。

**预防**：环境变量模板按 compose 服务名填写；生产环境由 `.env` 注入。

## 3. 文档一直「处理中」/ Agent 任务永不完成

**症状**：上传文档后状态长时间不更新；`/api/agent/run` 入队后无进度事件。

**原因**：**worker 未部署或未消费队列**（app 只写不读）；或 `REDIS_URL` 未配置但期望多实例队列。

**处理**：
1. 确认 worker 进程运行（compose：`docker compose ps` 看 worker 服务；K8s：worker Deployment 副本数 > 0）；
2. 内存模式下 worker 与 app 同进程（`instrumentation-node.ts` 启动），确认未误禁用；
3. 检查队列积压：Redis 模式下 `LLEN bull:*:wait` 等队列键。

**预防**：部署自检清单勾选「worker 已部署」（见[部署指南](../ops/deployment-guide.md)）。

## 4. 上传/写入 EACCES 权限错误

**症状**：上传文档失败，日志报 `EACCES: permission denied` 写入 `/app/.uploads`。

**原因**：镜像以非 root `nextjs`（uid 1001）运行，上传卷不可写（卷首次挂载属主不匹配，或 K8s PVC 无 fsGroup）。

**处理**：
- Docker：确认使用命名卷（Dockerfile 已对 `/app/.uploads` `chown nextjs:nodejs`）；
- K8s：`securityContext.fsGroup: 1001`；
- 排查：`kubectl exec <pod> -- ls -ld /app/.uploads` 检查属主。

**预防**：使用 compose 默认卷配置；K8s 清单勿删 fsGroup。

## 5. API 请求 429 限流

**症状**：接口返回 429，响应含 `retryAfter` / `dimension`。

**原因**：命中限流维度配额（匿名 20 / 用户可配 / API Key 500 / KB 60，次/分）。

**处理**：
1. 读 `dimension` 定位维度，按 `retryAfter` 退避重试；
2. 高频集成检查是否误用匿名身份（应配 API Key，额度 500）；
3. 压测/演示场景按需调高档位环境变量（如 `RATE_LIMIT_PER_MIN=2000`）。

**预防**：生产监控 429 比例；SSE 端点已豁免无需处理。

## 6. v1 API 返回 403「缺少 scope」

**症状**：`/api/v1/*` 调用返回 403。

**原因**：API Key 的 scope 与端点要求不匹配（如 `chat:read` 密钥调 `POST /knowledge-bases` 需 `kb:write`）。

**处理**：重建密钥并勾选所需 scope；或用登录 JWT 会话调用（不受 scope 限制）。

**预防**：对照[端点 Scope 表](../api/reference.md)规划密钥 scope。

## 7. 向量检索失败 / 查不到结果

**症状**：问答引用为空或检索报错；切换 `pgvector` 后索引失败。

**原因**：`pgvector` 未创建 `vector` 扩展；或索引未迁移（内存索引未导入新后端）。

**处理**：
1. `CREATE EXTENSION IF NOT EXISTS vector;`；
2. `npx tsx scripts/migrate-vector-store.ts` 迁移存量索引；
3. 确认 `VECTOR_STORE` 与索引实际所在后端一致。

**预防**：切换后端先迁移再切环境变量；compose 用 `pgvector/pgvector` 镜像。

## 8. OCR 失败 / 扫描件识别为空

**症状**：扫描 PDF / 图片上传后无文本可检索。

**原因**：`OCR_ENABLED=false`；语言包缺失（`OCR_LANG` 需匹配文档语言，默认 `eng+chi_sim`）；超长文档超 `OCR_MAX_PAGES`（默认 20）。

**处理**：确认 OCR 开关与语言包；超长文档拆分上传；检查 `.tessdata/` 语言包就绪（首次自动下载）。

**预防**：混合语言文档显式配置 `OCR_LANG`。

## 9. CI 失败：prisma 迁移漂移

**症状**：CI `quality` job 的 `prisma migrate diff --exit-code` 失败。

**原因**：改了 `prisma/schema.prisma` 但未生成迁移，或迁移与 schema 不一致。

**处理**：`npx prisma migrate dev --name <描述>` 生成迁移并提交；不要手工改库。

**预防**：schema 变更流程见[开发规范](../standards/README.md)；PR 模板勾选「DB 迁移」项。

## 10. 问答质量差 / 答非所问

**症状**：回答与问题无关或引用错误。

**原因**：演示模式（本地抽取式生成）；`topK` 过小；文档未处理完成；重排/改写未开启。

**处理**：配置真实 LLM；检查 `kb.ready`；调大 `topK`；开启 `RERANK_ENABLED` / `QUERY_REWRITE_ENABLED`；对已上线文档使用「点赞/点踩」反馈降权纠偏。

**预防**：上线前用真实 Provider 验证检索质量（`RERANK_CANDIDATES` 默认 20 候选池）。

## 新增条目模板

```markdown
## N. <故障标题>

**症状**：<可观察现象，含报错信息>

**原因**：<根因，1-2 句>

**处理**：<按顺序的排查/修复步骤>

**预防**：<如何避免再次发生>
```

## 相关文档

- [常见问题 FAQ](faq.md)
- [监控与告警](../ops/monitoring.md)（值班速查）
- [部署指南](../ops/deployment-guide.md)（部署自检清单）

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版（10 项，依据仓库已知坑位沉淀） |
