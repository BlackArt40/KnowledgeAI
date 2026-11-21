---
title: "ADR-0010：单一运行时（Vue + Next API + TS worker + Prisma）"
description: 拆分线（Java business、Python AI、Flyway、nginx 切流）退役，主线收敛为单一运行时；记录收编项、删除范围与回滚边界
type: explanation
category: architecture
level: L1
version: 1.0.0
authors:
  - tech-lead
owner: 技术负责人
reviewed_at: 2026-11-20
review_interval: 180
status: published
applies_to: ">=1.4.0"
related:
  - ../system-design.md
  - adr-0008-ai-service-framework.md
  - adr-0009-business-service-language.md
---

# ADR-0010：单一运行时（Vue + Next API + TS worker + Prisma）

## 状态

已接受（accepted）

## 背景

2026-10 引入的服务拆分线（`services/business` Java、`services/ai` Python、nginx 网关、Flyway、K8s split）在 2026-11 已明显落后于主线：

- Flyway 只有 21 个迁移，Prisma 有 26 个；后续 5 个 schema 变更只在 Prisma。
- Java 缺少团队活动流、文档 OCC、邀请预留等主线功能；CI 无 Java/Maven job。
- Python 的向量库是进程内存，重启即失；主线 TS RAG 已有持久化后端。
- 前端只打 Next `/api`；netflix 网关切流从未成为默认生产路径。

继续维护两套实现会让每次 schema/功能变更都要双写，且拆分栈无门禁会静默腐坏。

## 决策

1. 唯一运行时：**Vue 静态前端 + Next API + TypeScript worker + Prisma/PostgreSQL**。
2. 唯一迁移治理：`prisma/migrations/`；删除 Flyway 与 `services/business`。
3. 唯一认证权威：Next 自签 `kai-token`；删除 Java 的 JWT/2FA 实现。
4. RAG/Agent 默认走进程内 TS 实现；删除 `services/ai` 与 `AI_SERVICE_URL` 远程分支。
5. 收编拆分线唯一确认缺失的行为：Agent SSE 25s 保活与 `AGENT_STREAM_TIMEOUT_SECONDS` 硬超时。
6. 部署：Vue 构建产物并入 Next 镜像，由 Next 同时服务页面与 `/api`；不再维护 split compose、K8s split、nginx 切流脚本，也不再单独发布静态包。

## 后果

- 删除 `services/`、拆分 compose、`k8s/split.yaml`、`deploy/nginx*`、切流/演练脚本与 `AI_*` 环境变量。
- `ai-contract` 退役守卫已在分支保护更新后移除；当前 CI 为 8 个 job。
- 生产若仍把 `/api` 指向 Java，必须先切回 Next；本 ADR 不代替实际流量切换。
- 数据库若已有 `flyway_schema_history`，先备份再删除 Flyway；Prisma 仍是唯一后续迁移来源。
- 历史验收记录保留在 `deliverables/service-split/`，不作为可执行方案。
