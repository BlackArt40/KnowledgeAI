---
title: UI 设计体系
description: KnowledgeAI UI 设计体系：技术栈、设计令牌、主题与组件库
type: explanation
category: architecture
level: L1
version: 1.3.3
authors:
  - product-team
owner: 产品负责人
reviewed_at: 2026-10-29
review_interval: 180
status: published
applies_to: ">=1.2.0"
related:
  - overview.md
  - ../getting-started/product-overview.md
---

# KnowledgeAI · UI 设计体系

> 本文为 UI 设计体系说明（原《设计说明.md》第一部分，已拆分归档）。相关后端实现见[设计与实现记录（归档）](../archive/design-and-implementation-log.md)。

---

> 本文档定义 KnowledgeAI 的 UI 体系：技术栈、设计令牌与组件库；完整页面清单见[产品概述](../getting-started/product-overview.md)。

---

## 一、技术栈

- **前端**：Vue 3.5 + Element Plus + Vite 7（`frontend/`，28/28 页面全量承载；首页构建期 SEO 预渲染）
- **后端**：Next.js 16 纯 API（Route Handlers + SSE 流式；页面层已退役）
- **样式**：Element Plus 主题适配（`element-adapter.css` 映射 EP 变量）+ CSS 变量设计令牌单源（`frontend/src/styles/tokens.css`）+ 元素级基线（`base.css`）；五层加载顺序与各层职责见 [前端编码规范](../standards/frontend-coding-standards.md)
- **图标**：`@element-plus/icons-vue` + 自绘 SVG
- **主题**：系统 / 亮 / 暗三模式 + 高对比度（WCAG AA，令牌见 tokens.css）+ Workspace 品牌色（客户端注入，P5-5 引擎）

---

## 二、设计系统

围绕**靛蓝（Indigo）**品牌色构建，辅以紫罗兰渐变高亮。
- 主色 `--primary`：亮 `hsl(243 75% 59%)` / 暗 `hsl(243 80% 67%)`；品牌渐变 `--brand-from/--via/--to`
- 语义色 `success` / `warning` / `destructive`
- 圆角阶梯：`--radius 0.75rem` 为 EP 控件基线（`element-adapter.css` 把它映射成 `--el-border-radius-base/small`，改它会让按钮/输入/下拉/弹窗一起变圆）；`--radius-card 0.875rem` 给 `.card`；`--radius-lg 1rem` / `--radius-xl 1.25rem` / `--radius-2xl 1.5rem` 给内容容器（分区块 / 大卡 / 全宽面板），另有 `--radius-sm 0.5rem` 用于卡内小件
- 胶囊 `--radius-full`（9999px）统一掉原字面量写法；卡内小件（4 / 6 / 7 / 9 / 10 / 11px）刻意不参与阶梯，属**登记例外**——可写字面量，但不得新增该集合以外的值。三分法规则见[前端编码规范](../standards/frontend-coding-standards.md)第 3 节
- 反面色面 `--surface-inverse` / `--surface-inverse-deep`：营销 CTA、定价主推卡、认证页品牌面板共用，两套主题下都是深底（故只在 `:root` 定义）；该面上的前景色成组定义为 `--primary-on-inverse` / `--success-on-inverse` / `--border-on-inverse`
- 阴影四档 `--shadow-xs/sm/md/lg`（暗色单独一套更重的不透明度）；缓动 `--ease-out`
- 顶栏高度令牌 `--topbar-h 72px`：`.topbar` / `.side-head` 与 `chat-view.css` 的视口高度计算共用
- 动效：aurora 极光、marquee 跑马灯、打字机流式、处理进度条、卡片 hover 上浮；主题切换 `theme-transition` 交叉淡入（尊重 prefers-reduced-motion）

---

## 相关文档

- [产品概述](../getting-started/product-overview.md) — 完整页面清单与产品定位
- [总体架构](overview.md) — 系统架构与核心决策
- [项目结构](../getting-started/project-structure.md) — 组件目录与代码导览
- [前端编码规范](../standards/frontend-coding-standards.md) — 共享资产单源、样式分层、令牌纪律、i18n 与验证命令
- [设计与实现记录（归档）](../archive/design-and-implementation-log.md) — 历史实现细节

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.3.3 | 2026-10-29 | 圆角规则校准为三分法（阶梯走令牌 / 胶囊 `--radius-full` / 卡内小件登记例外）：新增 `--radius-full` 并替换 60 处 `9999px`；阶梯字面量存量约 158 处待分批清理 |
| 1.3.2 | 2026-10-29 | 样式分层改为五层（元素级基线独立为 `base.css`，令牌层只留值）；反面色面补齐 `--surface-inverse-deep` 与 `--primary/success/border-on-inverse` 三色，替换 6 处手写字面量；类名与实现对齐（`.grad-text`→`.cta-accent`、`.btn-grad`→`.btn-primary`、`.bg-orbit`→`.bg-rings`）；规范单列到前端编码规范 |
| 1.3.0 | 2026-10-27 | 设计令牌细化：圆角拆成 `--radius`（EP 控件基线）/`--radius-card`（卡片），新增 `--shadow-xs/sm/md/lg`、`--ease-out`、`--topbar-h`；全局焦点环与 `prefers-reduced-motion` 兜底 |
| 1.3.1 | 2026-10-28 | 圆角补齐 `--radius-sm/lg/xl/2xl` 阶梯并替换营销页字面量；新增 `--surface-inverse`（暗面共用）；页脚与正文同宽、顶栏与内容左右对齐；字重中间值（550/650）确认依赖可变量字，写入令牌注释 |
| 1.2.0 | 2026-10-19 | 前端绞杀重写收官（V0-V8）：技术栈改为 Vue 3 + Element Plus + Vite，令牌单源迁至 frontend/src/styles/tokens.css，高对比度覆盖规则随迁（WCAG AA 断言恢复） |
| 1.1.0 | 2026-09-23 | 删除已完成的「后续开发计划」与重复的页面清单；组件数校正为 17 |
| 1.0.0 | 2026-08-20 | 初版（原《设计说明.md》第一部分） |
