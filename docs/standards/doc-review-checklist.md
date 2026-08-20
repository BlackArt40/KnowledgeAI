---
title: 文档评审 Checklist
description: PR 评审技术文档时的逐项核对清单，覆盖元数据、结构、示例、术语与链接
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

# 文档评审 Checklist

> **使用方式**：PR 评审人逐项勾选；L2 及以上文档额外要求语言审校。全项通过后方可合并发布。

## 元数据

- [ ] Frontmatter 必填字段完整且合法（CI 自动校验）
- [ ] `owner` 已指定且是唯一维护责任人
- [ ] `type` / `category` / `level` 与文档内容匹配
- [ ] `applies_to` 已标注适用的软件版本（对外文档必填）

## 结构与目的

- [ ] 属于正确象限，不混写（教程 / 指南 / 参考 / 解释）
- [ ] 5 秒测试通过：标题 + description 能说明「这是什么 / 为什么重要 / 怎么开始」
- [ ] 一个概念一个章节，无信息墙
- [ ] 单篇 < 500 行（超长已拆分并建立索引）
- [ ] 每篇仅一个 H1，标题层级不跳级

## 示例与准确性

- [ ] 代码示例已实测可运行且标注语言
- [ ] 占位符规范（`<必填>` / `[可填]`），无真实密钥
- [ ] 涉及代码变更的，文档已同步更新（PR 门禁确认）

## 术语与风格

- [ ] 术语与[术语表](../standards/glossary.md)一致，无同义混用
- [ ] 第二人称、现在时、主动语态
- [ ] 中英混用符合规范（正文中文、技术术语保留英文）

## 链接与资源

- [ ] 内部相对链接有效（CI 检查）
- [ ] 图片存在且命名规范（`assets/` 目录）
- [ ] 无指向已归档文档的死链
