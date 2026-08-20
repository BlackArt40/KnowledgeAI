---
title: 监控与告警
description: KnowledgeAI 可观测性手册：健康检查探针、就绪告警状态机、SLI 指标、追踪、日志与 Sentry
type: how-to
category: ops
level: L2
version: 1.0.0
authors: [technical-writer]
owner: devops-owner
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [deployment-guide.md, env-vars.md, ../faq/troubleshooting.md]
---

# 监控与告警

> 本文介绍 KnowledgeAI 的可观测性体系：探针与告警、SLI 指标、链路追踪、结构化日志与错误上报。运维值班请先读本节「告警响应」。

## 健康检查探针

| 探针 | 端点 | 语义 | 返回 |
|------|------|------|------|
| 存活（liveness） | `GET /api/health` | 进程存活，与依赖**解耦** | 恒 200：`{ status, version, uptimeMs, ts }` |
| 就绪（readiness） | `GET /api/health/ready` | **并行检查 DB / Redis / LLM 连通性** | 全绿 200 `ok`；任一依赖不可达 503 `degraded` |

- 未配置的依赖（演示模式）计为 `skipped`，是合法运行态，不判 degraded；
- 就绪响应含 `checks`（逐项状态）、`degraded`（故障列表）、`degradedSince`；
- 两个端点均在限流豁免（`SKIP_PATHS`）中，可被高频探测。

**Docker / K8s 三探针映射**（详见[部署指南](deployment-guide.md)）：

| 平台 | 存活 | 就绪 |
|------|------|------|
| Dockerfile | `HEALTHCHECK`（`wget ... /api/health`） | —（compose 依赖 `depends_on: service_healthy`） |
| compose | app 容器 `healthcheck` | redis `redis-cli ping` / postgres `pg_isready` |
| K8s | `livenessProbe` → `/api/health` | `readinessProbe` → `/api/health/ready`（503 自动摘流量） |

## 就绪告警状态机

`/api/health/ready` 内部由 `src/lib/health/readiness.ts` 驱动状态机：

- **触发**：`ok → degraded` 转换时**立即告警一次**（站内通知 owner + admin + 结构化日志 + Sentry）；
- **去重**：告警后 10 分钟窗口内不重复告警（避免探针抖动刷屏）；
- **恢复**：`degraded → ok` 时发送恢复通知。

**告警响应流程**（值班）：

1. 查看 `GET /api/health/ready` 的 `degraded` 列表，定位故障依赖；
2. 检查依赖连通性：`SELECT 1`（DB）/ `redis-cli ping` / `GET /models`（LLM）；
3. 确认是依赖故障还是网络/配置问题（见[故障排查](../faq/troubleshooting.md)）；
4. 修复后探针自动恢复，无需人工重置。

## SLI 指标（内存存储）

`src/lib/obs/metrics.ts` 维护进程内 SLI，管理端 `/admin/monitoring` 仪表盘可视化：

| 指标 | 说明 |
|------|------|
| 请求 QPS / 错误率 | API 层聚合（status-aware） |
| 延迟 P50 / P95 / P99 | 请求延迟分位 |
| RAG 检索耗时 | `recordRag(durationMs, failed)` |
| LLM Token / 成本 / 模型分布 | Provider 用量聚合 |

> 内存存储：重启即清零，适合单实例观测；多实例/长期留存建议将日志与指标导出到外部系统（Loki / Sentry / 自建 Prometheus 采集）。

## 链路追踪（ALS span 树）

- 自研 AsyncLocalStorage 追踪：`API → RAG → LLM` 全链路 span 树；
- 每个请求携带 `X-Trace-Id`，贯穿日志与错误上报，用于跨模块排障；
- 客户端请求头缺失时服务端自动生成。

## 结构化日志

- **pino JSON**（`LOG_LEVEL` 控制级别，默认 `info`）；
- **敏感字段自动脱敏**：内置键表（`apiKey` / `password` / `token` / `secret` / `authorization` / `cookie` 及一二级嵌套通配），可用 `LOG_REDACT_KEYS` 追加；
- **聚合**：设置 `LOG_LOKI_URL` 后批量推送 Loki（JSON Push API）；未设置 = stdout JSON 行；
- 管理端 `/api/admin/logs` 提供日志查询。

## 错误上报（Sentry）

- 设置 `SENTRY_DSN` 后，前端 + 后端错误经 **Envelope 协议零依赖直投**（无 SDK）；
- 未设置 = 错误保留在内存 ring 与 `/admin/monitoring` 面板。

## 值班速查

| 症状 | 第一步 | 详见 |
|------|--------|------|
| 探针 503 degraded | 看 `degraded` 列表 → 检查依赖连通 | [故障排查](../faq/troubleshooting.md) |
| 请求 429 | 读 `Retry-After` / `dimension` → 检查限流档位 | [错误码表](../api/errors.md) |
| 错误率上升 | 用 `X-Trace-Id` 串联日志定位链路 | 本节「链路追踪」 |
| worker 积压 | 检查 worker 进程与 Redis 队列 | [部署指南](deployment-guide.md) |

## 相关文档

- [部署指南](deployment-guide.md)
- [环境变量全表](env-vars.md)
- [故障排查](../faq/troubleshooting.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版（依据 src/lib/health、src/lib/obs 源码核对） |
