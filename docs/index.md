---
title: KnowledgeAI 文档中心
description: KnowledgeAI 技术文档门户，按分类索引检索入门指南、架构设计、API 参考、开发规范、部署运维与 FAQ
type: reference
category: getting-started
level: L1
version: 1.4.0
authors: [technical-writer]
owner: 技术文档负责人
reviewed_at: 2026-09-23
review_interval: 180
status: published
applies_to: ">=1.2.0"
---

# KnowledgeAI 文档中心

> 上传文档 → AI 构建知识库 → 团队智能问答 → 自动生成调研报告。一站式企业级 AI 知识平台。
>
> 本门户按 Divio 系统（教程 / 指南 / 参考 / 解释）组织；文档体系的决策沿革见[归档方案](archive/technical-docs-strategy.md)。

## 快速入口

| 场景 | 去这里 |
|------|--------|
| 我想 5 分钟跑起来 | [快速开始](getting-started/quickstart.md) |
| 我是新成员，怎么上手 | [新成员入门指南](getting-started/onboarding.md) |
| 我要贡献代码或文档 | [贡献指南](getting-started/contribution-guide.md) |
| 我要调用 API 或 SDK | [API 使用指南](api/guide.md) · [API 参考](api/reference.md) |
| 我要部署或排查故障 | [部署指南](ops/deployment-guide.md) · [故障排查](faq/faq.md#troubleshooting) |
| 我要写文档或评审文档 | [文档规范与模板](standards/README.md) |
| 我要理解系统设计 | [总体架构](architecture/overview.md) |

## 六大文档类别

> 完整页面导航见左侧边栏；下表只说明各类别的职责与就绪状态。

| 类别 | 目录 | 内容 | 状态 |
|------|------|------|------|
| 入门指南 | `getting-started/` | 快速开始（含演示账号）/ 新成员 / 贡献 / 账号安全 / 产品概述 / 项目结构 | ✅ 已就绪 |
| 架构设计 | `architecture/` | 总体架构 / RAG / Agent / UI 设计体系 / 2 项 ADR | ✅ 已就绪 |
| API 参考 | `api/` | 指南 / 参考（OpenAPI 生成）/ 三语言 SDK / Webhook / 错误码 | ✅ 已就绪 |
| 文档规范 | `standards/` | 编写规范 / 评审 Checklist / 术语表 / 模板已就绪；代码 / Git / 测试规范待建 | 部分完成 |
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
- 变更随代码 PR 走 CI 门禁（`docs` job：死链 / Frontmatter / API 漂移 / 环境变量一致性）；
- 发现文档问题：在页面底部提交反馈，或在代码仓库中直接提 PR。

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.4.0 | 2026-09-23 | 移除与侧边栏重复的逐文件清单；合并 FAQ 与排障、演示账号与快速开始、三语言 SDK；技术文档体系方案归档 |
| 1.3.0 | 2026-09-05 | 清单补充账号安全指南；docs 门禁描述与 CI 对齐；移除 GitHub 占位链接 |
| 1.2.0 | 2026-08-20 | 存量文档拆分迁移：设计说明拆分为 UI 设计体系 + 归档实现记录；ROADMAP 归档；中文文件名迁移 kebab-case（含旧路径重定向）；新增入门指南（快速开始/新成员/贡献/演示账号） |
| 1.1.0 | 2026-08-20 | 新增架构设计（overview/RAG/Agent/ADR）与 API（指南/参考/错误码/Webhook/三语言 SDK）文档 |
| 1.0.0 | 2026-08-20 | 建立文档门户（VitePress 骨架首版） |
