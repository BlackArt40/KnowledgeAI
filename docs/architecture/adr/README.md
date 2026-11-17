---
title: 架构决策记录（ADR）索引
description: docs/architecture/adr/ 全部 ADR 的索引与编号规则，含 ADR-0004/0005 断档说明
type: reference
category: architecture
level: L1
version: 1.0.0
authors:
  - tech-lead
owner: 技术负责人
reviewed_at: 2026-11-12
review_interval: 180
status: published
applies_to: ">=1.2.0"
---

# 架构决策记录（ADR）索引

本目录收录 KnowledgeAI 的全部架构决策记录。模板见[ADR 模板](../../standards/templates/adr)。

## 索引

| 编号 | 标题 | 决策状态 |
| --- | --- | --- |
| [ADR-0001](adr-0001-in-memory-store-write-through-db.md) | 内存存储 + 写穿数据库 | accepted |
| [ADR-0002](adr-0002-background-job-queue.md) | 后台任务队列 | accepted |
| [ADR-0003](adr-0003-multi-tenant-isolation.md) | 多租户隔离契约 | accepted |
| [ADR-0006](adr-0006-read-path-storage-evolution.md) | 读路径存储演进（鉴权态共享化） | accepted |
| [ADR-0007](adr-0007-queue-backpressure.md) | 队列背压 | accepted |
| [ADR-0008](adr-0008-ai-service-framework.md) | AI 服务框架选型（FastAPI / 裸写 RAG / LangGraph / arq） | accepted |
| [ADR-0009](adr-0009-business-service-language.md) | 业务服务语言选型（Java 17 + Spring Boot 3） | accepted |

## 编号规则

- 编号 `ADR-XXXX` 顺序递增，**永不复用**：即使某篇 ADR 被废弃或取代，其编号也只标注 `superseded`，新决策不得占用旧号。
- 新增 ADR 复制[模板](../../standards/templates/adr)到本目录，命名 `adr-00XX-<kebab-case>.md`，并同步登记到上表与 `.vitepress/config.mts` 侧边栏。
- 被取代的 ADR 在正文"状态"章节注明取代它的编号，索引表保留原行。

## 编号断档说明

**ADR-0004 与 ADR-0005 自始未使用**（经 git 全历史检索确认，从未存在过对应文件或草稿）。这两个编号视为历史断档，**保留空缺、不予补发**，后续新 ADR 从 **ADR-0010** 顺延。
