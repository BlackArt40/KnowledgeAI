---
title: 新文档模板
description: 创建技术文档的标准模板，含 Frontmatter 元数据与正文结构骨架
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

# 新文档模板

> **使用方式**：复制本文件到目标目录（如 `docs/architecture/`），修改 Frontmatter 与正文后按[文档编写规范](../doc-writing-standards.md)完善。

```markdown
---
title: <文档标题>
description: <一句话描述，含 2-3 个检索词>
type: <tutorial | how-to | reference | explanation>
category: <getting-started | architecture | api | standards | ops | faq>
level: L1
version: 0.1.0
authors: [<你的名字>]
owner: <负责人>
reviewed_at: <今天>
review_interval: 180
status: draft
applies_to: ">=1.2.0"
---

# <标题>

<!-- 1. 目的：这篇文章帮读者达成什么结果（1-2 句） -->

## 背景 / 前置条件

<!-- 读者需要已掌握什么、已安装什么、已配置什么 -->

## 正文

<!--
- 一个概念一个章节，章节间不混写（教程/指南/参考/解释只选一种）
- 代码示例标注语言且可运行，占位符用 <必填> 与 [可填]
- 涉及图片放入同目录 assets/
-->

## 常见问题

<!-- 留空则删除本节 -->

## 相关文档

- [术语表](../standards/glossary.md)
- [文档编写规范](../standards/doc-writing-standards.md)
```
