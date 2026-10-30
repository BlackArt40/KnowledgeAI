---
title: UI 设计体系
description: KnowledgeAI UI 设计体系：技术栈、设计令牌、主题与组件库
type: explanation
category: architecture
level: L1
version: 1.4.0
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
- 语义色 `success` / `warning` / `destructive`（随主题翻转，供正文与表单态使用）
- 固定状态色（不随主题翻转，只在 `:root` 定义）：`--positive` / `--positive-text` / `--positive-strong`（状态点、徽章、进度、diff 新增）、`--negative` / `--negative-strong`（diff 删除）、`--warning-bright` / `--warning-text`（琥珀状态点与 warn 徽章）。这组原先以 `hsl(142 …)` / `#16a34a` / `#f59e0b` / `#b45309` 等字面量散落在组件里
- 圆角阶梯：`--radius 0.75rem` 为 EP 控件基线（`element-adapter.css` 把它映射成 `--el-border-radius-base/small`，改它会让按钮/输入/下拉/弹窗一起变圆）；`--radius-card 0.875rem` 给 `.card`；`--radius-lg 1rem` / `--radius-xl 1.25rem` / `--radius-2xl 1.5rem` 给内容容器（分区块 / 大卡 / 全宽面板），另有 `--radius-sm 0.5rem` 用于卡内小件
- 胶囊 `--radius-full`（9999px）统一掉原字面量写法；**登记例外**（可写字面量，但不得新增集合外的值）：卡内小件 `4 / 6 / 7 / 9 / 10 / 11 / 13px`、大件装饰 `28px`（演示台外壳）/ `40px`（hero 光晕）。三分法规则见[前端编码规范](../standards/frontend-coding-standards.md)第 3 节
- 反面色面 `--surface-inverse` / `--surface-inverse-deep`：营销 CTA、定价主推卡、认证页品牌面板共用，两套主题下都是深底（故只在 `:root` 定义）；该面上的前景色成组定义为 `--primary-on-inverse` / `--success-on-inverse` / `--border-on-inverse`
- 阴影四档 `--shadow-xs/sm/md/lg`（暗色单独一套更重的不透明度）；缓动 `--ease-out`（进入动画）与 `--ease-out-quad`（状态点 ping）
- 顶栏高度令牌 `--topbar-h 72px`：`.topbar` / `.side-head` 与 `chat-view.css` 的视口高度计算共用
- 动效：aurora 极光、marquee 跑马灯、打字机流式、处理进度条、卡片 hover 上浮；主题切换 `theme-transition` 交叉淡入（尊重 prefers-reduced-motion）

### 装饰色板（分类色，2026-10-30 定型）

用来回答「这类资源是什么」——图标 tint、图表、知识图谱实体类型。与状态色**严格分工**：状态色表达好 / 坏 / 警告（`--positive*` / `--negative*` / `--warning-*`），分类色只表达类别，不带褒贬。

| 令牌 | 值（Tailwind 档） | 语义 | 典型使用 |
|------|------------------|------|----------|
| `--tint-indigo` | `239 84% 67%`（indigo-500） | 知识库默认 / 人物实体 | KB 头像、图谱节点 |
| `--tint-sky` | `199 89% 48%`（sky-500） | 组织实体 / 外部网页来源 / 共享 / RAG | 来源图标、共享标记、`.k-rag` |
| `--tint-sky-text` | `200 98% 39%`（sky-600） | 天蓝系文字 | 分享态文字（白底 AA） |
| `--tint-emerald` | `160 84% 39%`（emerald-500） | API / 文档 / 概念实体 | 用量指标、`.k-doc` |
| `--tint-violet` | `258 90% 66%`（violet-500） | Agent / LLM | Agent 指标、`.k-llm` |
| `--tint-teal` | `173 80% 40%`（teal-500） | 团队 / 协作 | 管理端 tint |
| `--tint-orange` | `25 95% 53%`（orange-500） | 用量 / 计费 | 管理端 tint |
| `--tint-pink` | `330 81% 60%`（pink-500） | 通知 / 消息 | 管理端 tint |
| `--tint-rose` | `350 89% 60%`（rose-500） | 风险 / 告警类别 | KB 头像色板 |
| `--tint-fuchsia` | `292 84% 61%`（fuchsia-500） | 头像选色（无语义） | KB 头像色板 |

规则：

- 图形（图标 / 圆点 / 柱条）一律取 500 档；tint 若当**文字**用，取更深一档（现只有 `--tint-sky-text`）。
- 不随主题翻转（只在 `:root` 定义）；500 档在暗色底上仍有足够亮度。
- 新增分类场景**先复用上表**；确实需要新 hue 时按 500 档补一行并写明语义，不要临时取色。
- **数据侧**（SVG `fill` 属性、落进数据库的头像色）用 `frontend/src/lib/palette.ts` 的 `TINTS` / `KB_COLORS` / `ENTITY_COLORS`，与令牌一一对应；两边改色必须同步。

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
| 1.4.0 | 2026-10-30 | 装饰（分类）色板定型：`--tint-*` 十档按 Tailwind 500 档取值并分配语义（知识库/人物、组织/来源、API/文档/概念、Agent/LLM、团队、用量、通知、风险、头像选色），20 处 CSS 字面量改为令牌；数据侧（SVG `fill` / 落库头像色）统一走 `frontend/src/lib/palette.ts`；状态色与分类色正式分工 |
| 1.3.6 | 2026-10-29 | 新增 `--ease-out-quad`（状态点 ping 曲线），替换 3 处 `cubic-bezier(0, 0, 0.2, 1)` 字面量；规范补齐阴影与缓动条款（阶梯阴影走令牌、品牌光晕与描边环允许字面量、自定义曲线必须走 `--ease-*`） |
| 1.3.5 | 2026-10-29 | 新增固定状态色组（`--positive*` / `--negative*` / `--warning-bright` / `--warning-text`）与 `--primary-soft`，替换 52 处状态色字面量（hsl 142 绿族 24 处、`#f59e0b`/`#b45309` 琥珀 17 处、diff 红绿 6 处、`rgb(… / α)` 4 处）；同色不同亮的正向文字统一到 `--positive-text`（38/40/35→35，差 ≤5 个明度点）；装饰色板仍待设计定色 |
| 1.3.4 | 2026-10-29 | 阶梯圆角存量清零：152 处阶梯字面量与 63 处胶囊字面量全部令牌化（含 4 处气泡多值写法与 4 处 `el-skeleton-item` 内联样式）；登记例外补 `13px` 小件与 `28px` / `40px` 大件装饰 |
| 1.3.3 | 2026-10-29 | 圆角规则校准为三分法（阶梯走令牌 / 胶囊 `--radius-full` / 卡内小件登记例外）：新增 `--radius-full` 并替换 60 处 `9999px`；阶梯字面量存量约 158 处待分批清理 |
| 1.3.2 | 2026-10-29 | 样式分层改为五层（元素级基线独立为 `base.css`，令牌层只留值）；反面色面补齐 `--surface-inverse-deep` 与 `--primary/success/border-on-inverse` 三色，替换 6 处手写字面量；类名与实现对齐（`.grad-text`→`.cta-accent`、`.btn-grad`→`.btn-primary`、`.bg-orbit`→`.bg-rings`）；规范单列到前端编码规范 |
| 1.3.0 | 2026-10-27 | 设计令牌细化：圆角拆成 `--radius`（EP 控件基线）/`--radius-card`（卡片），新增 `--shadow-xs/sm/md/lg`、`--ease-out`、`--topbar-h`；全局焦点环与 `prefers-reduced-motion` 兜底 |
| 1.3.1 | 2026-10-28 | 圆角补齐 `--radius-sm/lg/xl/2xl` 阶梯并替换营销页字面量；新增 `--surface-inverse`（暗面共用）；页脚与正文同宽、顶栏与内容左右对齐；字重中间值（550/650）确认依赖可变量字，写入令牌注释 |
| 1.2.0 | 2026-10-19 | 前端绞杀重写收官（V0-V8）：技术栈改为 Vue 3 + Element Plus + Vite，令牌单源迁至 frontend/src/styles/tokens.css，高对比度覆盖规则随迁（WCAG AA 断言恢复） |
| 1.1.0 | 2026-09-23 | 删除已完成的「后续开发计划」与重复的页面清单；组件数校正为 17 |
| 1.0.0 | 2026-08-20 | 初版（原《设计说明.md》第一部分） |
