---
title: 服务拆分（已退役）
description: 服务拆分方案于 2026-11-20 退役；本页仅保留历史入口，不再描述可执行的 Java/Python 拆分部署
type: explanation
category: architecture
level: L2
version: 2.0.0
authors:
  - technical-writer
owner: 技术负责人
reviewed_at: 2026-11-20
review_interval: 180
status: archived
applies_to: ">=1.4.0"
related:
  - system-design.md
  - adr/adr-0008-ai-service-framework.md
  - adr/adr-0009-business-service-language.md
---

# 服务拆分（已退役）

2026-11-20 起，`services/business`（Java）与 `services/ai`（Python）已从仓库删除，拆分线不再维护。

当前唯一运行时：**Vue 页面 + Next API + TypeScript worker + Prisma/PostgreSQL**（页面与 API 同一镜像）。

- 业务 API、认证、知识库、Chat/Agent、Webhook、计费、限流、审计均由 `src/` 主线承载。
- 数据库迁移的唯一来源是 `prisma/migrations/`；Flyway 已随 Java 服务删除。
- 原拆分部署、K8s split、nginx 切流与 Flyway 验收步骤不再适用。
- 历史决策背景见 `docs/archive/design-and-implementation-log.md` 与 ADR-0008/0009（均标记 Superseded）。

需要部署方式时见 `docs/ops/deployment-guide.md`「方式五：单镜像（Vue + Next API）」。
