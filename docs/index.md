---
title: KnowledgeAI 文档中心
description: KnowledgeAI 技术文档门户，按分类索引检索入门指南、架构设计、API 参考、开发规范、部署运维与 FAQ
type: reference
category: getting-started
level: L1
version: 1.0.0
authors: [technical-writer]
owner: 技术文档负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
---

# KnowledgeAI 文档中心

> 上传文档 → AI 构建知识库 → 团队智能问答 → 自动生成调研报告。一站式企业级 AI 知识平台。
>
> 本门户按[文档体系方案](standards/technical-docs-strategy.md)组织，文档分类遵循 Divio 系统（教程 / 指南 / 参考 / 解释）。

## 快速入口

| 场景 | 去这里 |
|------|--------|
| 我想 5 分钟跑起来 | [快速开始](getting-started/quickstart.md) |
| 我是新成员，怎么上手 | [新成员入门指南](getting-started/onboarding.md) |
| 我要贡献代码或文档 | [贡献指南](getting-started/contribution-guide.md) |
| 我要调用 API 或 SDK | [API 使用指南](api/guide.md) · [API 参考](api/reference.md) |
| 我要部署或排查故障 | [部署指南](ops/deployment-guide.md) · [故障排查](faq/troubleshooting.md) |
| 我要写文档或评审文档 | [文档规范与模板](standards/README.md) |
| 我要理解系统设计 | [总体架构](architecture/overview.md) |

## 现有文档清单

| 文档 | 说明 | 状态 |
|------|------|------|
| [技术文档体系方案](standards/technical-docs-strategy.md) | 文档体系设计与落地路径 | L1 · 草案待评审 |
| [文档编写规范](standards/doc-writing-standards.md) | 元数据 / 命名 / 示例 / 术语 / 检索标准 | L1 · 已发布 |
| [文档评审 Checklist](standards/doc-review-checklist.md) | PR 评审核对清单 | L1 · 已发布 |
| [术语表](standards/glossary.md) | 统一术语定义 | L1 · 已发布 |
| [总体架构](architecture/overview.md) | 系统架构总览与核心决策 | L1 · 已发布 |
| [RAG 引擎架构](architecture/rag-engine.md) | 检索增强生成引擎设计 | L1 · 已发布 |
| [Agent 编排架构](architecture/agent-orchestration.md) | 多 Agent 调研编排设计 | L1 · 已发布 |
| [ADR 决策记录](architecture/adr/adr-0001-in-memory-store-write-through-db.md) | 内存存储+写穿、后台队列两项决策 | L1 · 已发布 |
| [UI 设计体系](architecture/design-system.md) | 设计令牌 / 组件库 / 页面清单 | L1 · 已发布 |
| [API 使用指南](api/guide.md) | 鉴权 / SSE 协议 / 限流 / 调用示例 | L2 · 已发布 |
| [API 参考](api/reference.md) | 端点总表（由 OpenAPI 自动生成） | L2 · 已发布 |
| [错误码表](api/errors.md) · [Webhook 指南](api/webhooks.md) | 错误处理与事件订阅 | L2 · 已发布 |
| [三语言 SDK](api/sdk-javascript.md) | JavaScript / Python / Go 使用指南 | L2 · 已发布 |
| [部署指南](ops/deployment-guide.md) | 四种部署方式与升级/回滚 | L2 · 已发布 |
| [环境变量全表](ops/env-vars.md) | 全部配置项与演示回退行为 | L2 · 已发布 |
| [监控与告警](ops/monitoring.md) | 探针 / SLI / 追踪 / 日志 / 值班速查 | L2 · 已发布 |
| [常见问题 FAQ](faq/faq.md) · [故障排查](faq/troubleshooting.md) | 高频问答与四段式排障 | L1 · 已发布 |
| [产品概述](getting-started/product-overview.md) | 产品定位与页面规划 | L1 · 已发布 |
| [快速开始](getting-started/quickstart.md) | 5 分钟跑通核心链路 | L2 · 已发布 |
| [新成员入门指南](getting-started/onboarding.md) | 一天上手开发与提交 | L1 · 已发布 |
| [贡献指南](getting-started/contribution-guide.md) | 分支 / 门禁 / PR / 文档同步 | L1 · 已发布 |
| [演示账号](getting-started/demo-accounts.md) | 四角色账号与演示数据 | L1 · 已发布 |
| [项目结构](getting-started/project-structure.md) | 目录组织与代码导览 | L1 · 已发布 |
| [ROADMAP（归档）](archive/ROADMAP.md) | 开发路线图实现记录 | 归档 · 可追溯 |
| [设计与实现记录（归档）](archive/design-and-implementation-log.md) | 原《设计说明》实现部分 | 归档 · 可追溯 |

## 六大文档类别

| 类别 | 目录 | 内容 | 状态 |
|------|------|------|------|
| 入门指南 | `getting-started/` | 快速开始 / 新成员 / 贡献 / 演示账号 / 产品概述 / 项目结构 | ✅ 已就绪 |
| 架构设计 | `architecture/` | 总体架构 / RAG / Agent / 2 项 ADR | ✅ 已就绪 |
| API 参考 | `api/` | 指南 / 参考（OpenAPI 生成）/ 三语言 SDK / Webhook / 错误码 | ✅ 已就绪 |
| 开发规范 | `standards/` | 文档规范已就绪；代码 / Git / 测试规范待建 | 部分完成 |
| 部署运维 | `ops/` | 部署手册 / 环境变量全表 / 监控告警 | ✅ 已就绪 |
| FAQ 与排障 | `faq/` | 高频问答 / 故障排查（四段式） | ✅ 已就绪 |

## 关键词速查

- **部署**：`部署` `Docker` `K8s` `环境变量` `蓝绿` `回滚`
- **鉴权**：`鉴权` `JWT` `API Key` `RBAC` `OAuth` `2FA`
- **故障**：`故障` `排障` `错误码` `限流 429` `502`
- **核心**：`RAG` `知识库` `Agent` `SSE` `检索` `向量库`
- **接口**：`API` `SDK` `Webhook` `OpenAPI` `限流`
- **治理**：`规范` `模板` `评审` `术语` `ADR`

## 文档治理

- 所有文档遵循[文档编写规范](standards/doc-writing-standards.md)，含 Frontmatter 元数据与 180 天复审周期；
- 变更随代码 PR 走 CI 门禁（`docs-check`）；
- 发现文档问题：在页面底部提交反馈，或到 [GitHub 仓库](https://github.com/) 直接提 PR。

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.2.0 | 2026-08-20 | 存量文档拆分迁移：设计说明拆分为 UI 设计体系 + 归档实现记录；ROADMAP 归档；中文文件名迁移 kebab-case（含旧路径重定向）；新增入门指南（快速开始/新成员/贡献/演示账号） |
| 1.1.0 | 2026-08-20 | 新增架构设计（overview/RAG/Agent/ADR）与 API（指南/参考/错误码/Webhook/三语言 SDK）文档 |
| 1.0.0 | 2026-08-20 | 建立文档门户（VitePress 骨架首版） |
