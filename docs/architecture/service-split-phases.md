---
title: 服务拆分阶段细则（已退役）
description: 阶段 0～6 的拆分细则已随服务拆分线退役；本页仅保留历史入口
type: explanation
category: architecture
level: L2
version: 2.0.0
authors:
  - tech-lead
owner: 技术负责人
reviewed_at: 2026-11-20
review_interval: 180
status: archived
applies_to: ">=1.4.0"
related:
  - service-split.md
  - system-design.md
  - adr/adr-0008-ai-service-framework.md
  - adr/adr-0009-business-service-language.md
---

# 服务拆分阶段细则（已退役）

阶段 0～6 的拆分实施、验收与切换步骤已于 2026-11-20 随拆分线一并退役。

- Java 业务服务、Python AI 服务、Flyway、split compose、K8s split、nginx 切流脚本均已删除。
- 主线唯一实现：Vue 静态前端 + Next API + TypeScript worker + Prisma。
- 当前部署方式见 `docs/ops/deployment-guide.md`。
- 历史阶段验收记录保留在 `deliverables/service-split/`，仅作归档。
