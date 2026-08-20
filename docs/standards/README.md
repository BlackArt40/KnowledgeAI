---
title: 文档规范与模板索引
description: docs/standards 目录导航，含文档编写规范、模板、评审清单与术语表
type: reference
category: standards
level: L1
version: 1.0.0
authors: [technical-writer]
owner: 技术文档负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
---

# 文档规范与模板索引

> 本目录沉淀 KnowledgeAI 的文档编写规范与配套模板，是文档体系的「规矩与工具」。**新文档、新评审一律以本目录文件为准。**

## 文件导航

| 文件 | 用途 | 何时使用 |
|------|------|----------|
| [文档编写规范](doc-writing-standards.md) | 元数据 / 命名 / 代码示例 / 术语 / 检索标准 | 写任何文档之前 |
| [新文档模板](templates/new-doc.md) | 标准文档骨架 | 创建新文档 |
| [ADR 模板](templates/adr.md) | 架构决策记录骨架 | 记录架构决策（放入 `docs/architecture/adr/`） |
| [文档评审 Checklist](doc-review-checklist.md) | PR 评审逐项核对清单 | 评审任何文档 PR |
| [术语表](glossary.md) | 统一术语定义与禁止混用对照 | 写作 / 评审时查词 |

## 快速上手

1. 新文档：复制 `templates/new-doc.md` → 填 Frontmatter → 按编写规范写正文 → 提交 PR；
2. 架构决策：复制 `templates/adr.md` → 编号 ADR-XXXX → 放入 `docs/architecture/adr/`；
3. 评审：打开 PR 后逐项勾选 [评审 Checklist](doc-review-checklist.md)，全过再合并。

## 相关文档

- [技术文档体系方案](technical-docs-strategy.md) — 体系设计与落地路径
- [文档门户](../index.md) — 全站导航
