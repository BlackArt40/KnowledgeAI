---
title: 架构决策记录（ADR）模板
description: 记录架构决策的背景、方案、备选与后果，编号 ADR-XXXX 顺序递增
type: reference
category: standards
level: L1
version: 1.0.0
authors: [technical-writer]
owner: 技术负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
---

# 架构决策记录（ADR）模板

> **使用方式**：复制本文件到 `docs/architecture/adr/`，命名为 `adr-00XX-<kebab-case>.md`，编号在仓库内顺序递增、不重复。
>
> **注意**：frontmatter 的 `status` 是**文档状态**（须用统一枚举 `draft|review|published|archived|deprecated`）；**决策状态**（proposed / accepted / superseded）写在正文「状态」章节，不要混淆。

```markdown
---
title: "ADR-00XX：<决策标题>"
type: explanation
category: architecture
level: L1
version: 1.0.0
authors: [<决策提出人>]
owner: <模块 Owner>
reviewed_at: <今天>
review_interval: 180
status: proposed
applies_to: ">=1.2.0"
---

# ADR-00XX：<决策标题>

## 状态

proposed / accepted / superseded（被 ADR-00YY 取代）

## 背景

<!-- 为什么需要决策？当前痛点是什么？有哪些约束（性能、成本、合规）？ -->

## 决策

<!-- 明确、简洁地陈述决策；说明决策边界与不适用范围 -->

## 备选方案

<!-- 考虑过的其他方案及被否原因（各 1-3 句） -->

## 后果

<!--
正面后果：
负面后果：
回滚方式：
-->

## 相关 ADR

<!-- 关联的决策记录链接，如 ADR-0001 -->
```
