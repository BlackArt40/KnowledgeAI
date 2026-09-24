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

- **框架**：Next.js 16（App Router、Turbopack、Route Handlers、SSE 流式）
- **样式**：Tailwind CSS v4 + CSS 变量设计令牌
- **组件**：shadcn 风格自建组件库 17 个（Button / Card / Input / Label / Badge / Separator / Skeleton / Avatar / Dialog / Select / Slider / Progress / Tabs / Switch / Table / DropdownMenu / Sheet）
- **图标**：lucide-react + 自绘品牌图标
- **字体**：Geist Sans / Geist Mono；**主题**：系统 / 亮 / 暗三模式 + 高对比度（WCAG AA）+ Workspace 品牌色（P5-5）

---

## 二、设计系统

围绕**靛蓝（Indigo）**品牌色构建，辅以紫罗兰渐变高亮。
- 主色 `--primary`：亮 `hsl(243 75% 59%)` / 暗 `hsl(243 80% 67%)`；品牌渐变 `bg-brand-gradient`
- 语义色 `success` / `warning` / `destructive`；圆角 `0.75rem`；柔和阴影；`max-w-6xl`
- 动效：aurora 极光、marquee 跑马灯、打字机流式、处理进度条、卡片 hover 上浮

---

## 相关文档

- [产品概述](../getting-started/product-overview.md) — 完整页面清单与产品定位
- [总体架构](overview.md) — 系统架构与核心决策
- [项目结构](../getting-started/project-structure.md) — 组件目录与代码导览
- [设计与实现记录（归档）](../archive/design-and-implementation-log.md) — 历史实现细节

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.1.0 | 2026-09-23 | 删除已完成的「后续开发计划」与重复的页面清单；组件数校正为 17 |
| 1.0.0 | 2026-08-20 | 初版（原《设计说明.md》第一部分） |
