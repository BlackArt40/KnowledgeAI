---
title: UI 设计体系
description: KnowledgeAI UI 设计体系：技术栈、设计令牌、主题与组件库
type: explanation
category: architecture
level: L1
version: 1.1.0
authors: [product-team]
owner: 产品负责人
reviewed_at: 2026-09-23
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [overview.md, ../getting-started/product-overview.md]
---

# KnowledgeAI · UI 设计体系

> 本文为 UI 设计体系说明（原《设计说明.md》第一部分，已拆分归档）。相关后端实现见[设计与实现记录（归档）](../archive/design-and-implementation-log.md)。

---

> 本文档定义 KnowledgeAI 的 UI 体系：技术栈、设计令牌与组件库；完整页面清单见[产品概述](../getting-started/product-overview.md)。

---

## 一、技术栈

- **前端**：Vue 3.5 + Element Plus + Vite 7（`frontend/`，28/28 页面全量承载；首页构建期 SEO 预渲染）
- **后端**：Next.js 16 纯 API（Route Handlers + SSE 流式；页面层已退役）
- **样式**：Element Plus 主题适配（`element-adapter.css` 映射 EP 变量）+ CSS 变量设计令牌单源（`frontend/src/styles/tokens.css`）
- **图标**：`@element-plus/icons-vue` + 自绘 SVG
- **主题**：系统 / 亮 / 暗三模式 + 高对比度（WCAG AA，令牌见 tokens.css）+ Workspace 品牌色（客户端注入，P5-5 引擎）

---

## 二、设计系统

围绕**靛蓝（Indigo）**品牌色构建，辅以紫罗兰渐变高亮。
- 主色 `--primary`：亮 `hsl(243 75% 59%)` / 暗 `hsl(243 80% 67%)`；品牌渐变 `--brand-from/--via/--to`
- 语义色 `success` / `warning` / `destructive`；圆角 `--radius 0.75rem`；柔和阴影
- 动效：aurora 极光、marquee 跑马灯、打字机流式、处理进度条、卡片 hover 上浮；主题切换 `theme-transition` 交叉淡入（尊重 prefers-reduced-motion）

---

## 相关文档

- [产品概述](../getting-started/product-overview.md) — 完整页面清单与产品定位
- [总体架构](overview.md) — 系统架构与核心决策
- [项目结构](../getting-started/project-structure.md) — 组件目录与代码导览
- [设计与实现记录（归档）](../archive/design-and-implementation-log.md) — 历史实现细节

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.2.0 | 2026-10-19 | 前端绞杀重写收官（V0-V8）：技术栈改为 Vue 3 + Element Plus + Vite，令牌单源迁至 frontend/src/styles/tokens.css，高对比度覆盖规则随迁（WCAG AA 断言恢复） |
| 1.1.0 | 2026-09-23 | 删除已完成的「后续开发计划」与重复的页面清单；组件数校正为 17 |
| 1.0.0 | 2026-08-20 | 初版（原《设计说明.md》第一部分） |
