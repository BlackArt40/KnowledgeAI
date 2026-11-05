---
title: 产品概述
description: KnowledgeAI 产品概述：产品定位、核心技术栈、页面模块与关键实现对照，以及后续迭代新增的页面路由
type: explanation
category: getting-started
level: L1
version: 1.3.0
authors:
  - product-team
owner: 产品负责人
reviewed_at: 2026-11-05
review_interval: 180
status: published
applies_to: ">=1.2.0"
related:
  - quickstart.md
  - project-structure.md
  - ../architecture/overview.md
  - ../architecture/design-system.md
---

# KnowledgeAI 产品概述

## 产品定位

**产品名**：KnowledgeAI（AI 知识助手 SaaS）

**一句话介绍**：上传文档 → AI 构建知识库 → 团队智能问答 → 自动生成调研报告

**整合的技术**：

| 技术领域  | 在产品中的体现                     |
| --------- | ---------------------------------- |
| 全栈开发  | Vue 3 前端（frontend/）+ Next.js 纯 API + PostgreSQL + Redis |
| AI/ML 应用 | RAG 问答 + Agent 调研 + 文档处理     |
| 云原生    | Docker 部署 + K8s 编排 + CI/CD       |
| 系统设计  | 多租户 + 微服务 + 消息队列         |
| 自动化    | GitHub Actions + 自动测试          |
| 业务理解  | 订阅计费 + 用量监控                |
| 安全合规  | 数据隔离 + GDPR 合规                |

---

## 页面与技术栈对应关系总览

| 页面（路由） | 关键实现 | 代码位置 |
|------|----------|----------|
| `/` 首页 | Vue 3 + Element Plus；构建期 SSR 预渲染出 `dist/home.html`（SEO 首帧）；PWA | `frontend/src/views/HomeView.vue`、`frontend/scripts/prerender-home.mjs` |
| 认证 6 页：`/login` `/register` `/verify-email` `/forgot-password` `/reset-password` `/2fa-enroll` | 自建 JWT 会话（`kai-token` cookie）+ PBKDF2 口令 + TOTP 两步验证 + 邮件验证；OAuth 由 Auth.js v5 仅作引擎、会话契约不变 | `src/lib/auth/`、`frontend/src/views/auth/` |
| `/dashboard` 工作台 | 聚合当前用户、知识库、任务与用量数据 | `DashboardView.vue` |
| `/knowledge-base`、`/knowledge-base/:id` | 分片上传 + 队列异步解析（`doc-process`）+ 正文 OCC 编辑 + Yjs 实时协同 | `KbListView.vue`、`KbDetailView.vue`、`src/lib/kb/`、`src/lib/collab/` |
| `/knowledge-base/:id/graph` | 实体 / 关系抽取 + SVG 力导向图（布局经 `@shared/kg/layout`） | `KbGraphView.vue`、`src/lib/kg/` |
| `/chat` 智能问答 | RAG 混合检索 + SSE 流式（`sources` → `token` → `done`）+ 语音输入 / 朗读 | `ChatView.vue`、`src/lib/chat/`、`src/lib/rag/` |
| `/agent` Agent 调研 | StateGraph 编排 + 任务队列 + SSE（`init` → `step` → `done`） | `AgentView.vue`、`src/lib/agent/` |
| `/team` 团队 | RBAC（owner / admin / editor / viewer）+ 邀请令牌 + 审计 + 评论 @提及 | `TeamView.vue`、`src/lib/team/` |
| `/billing`、`/checkout`、`/usage` | Stripe Checkout 真实收款；支付宝 / 微信为枚举内的演示通道（`payOrder` 直接置为已付）；用量按日聚合 | `src/lib/billing/`、`BillingView.vue`、`UsageView.vue` |
| `/api-keys` | API Key（`kai_sk_` 前缀、scope 校验、有效期） | `ApiKeysView.vue`、`src/lib/apikeys/` |
| `/settings` 设置 | 个人资料、安全（2FA / 会话 / OAuth 绑定）、外观主题、语言 | `SettingsView.vue` |
| `/admin`、`/admin/monitoring` | 管理端聚合看板；可观测性（trace / 日志 / 限流 / 队列，仅 Owner·Admin） | `AdminView.vue`、`MonitoringView.vue`、`src/lib/obs/` |
| `/developer`、`/docs` | 开发者门户（SDK / Webhook / 用量）+ Swagger UI（读 `/api/openapi.json`） | `DeveloperView.vue`、`DocsView.vue`、`src/lib/openapi/` |
| `/invite` 邀请落地 | 签名令牌的接受 / 拒绝加入工作区（需登录） | `InviteAcceptView.vue` |
| `/share-doc/:token`、`/share-kb/:token`、`/r/:id` 公开分享 | 令牌即凭据的只读公开页（单文档 / 整库 / Agent 报告） | `frontend/src/views/share/` |
| `/privacy`、`/terms`、`/maintenance` | 静态合规与维护页 | `frontend/src/views/static/` |

---

## 系统架构

架构图与数据流不在本文重复：[系统架构图与设计说明](../architecture/system-design.md) 给出上下文、部署拓扑、分层规则、模块地图与数据模型；[系统架构：数据流与契约](../architecture/system-design-runtime.md) 给出问答、文档入库、Agent 调研、鉴权限流四条链路与不可变契约；设计取舍见[总体架构](../architecture/overview.md)。

---

## 后续迭代新增页面（截至 2026-11-04）

原始规划的 25 个页面/能力已全部实现：一部分作为独立路由落地，一部分（文档上传、成员邀请、套餐对比、账单历史）集成在对应页面内。此后迭代又新增了以下 11 个页面路由；当前前端共 **30 个页面路由**（以 `frontend/src/router/index.ts` 为准，另有 1 条 404 兜底）：

| 路由 | 说明 |
|------|------|
| `/developer` | 开发者门户：SDK 快速开始、Webhook 订阅管理、API 用量统计、第三方集成 |
| `/docs` | Swagger UI 交互式 API 文档（渲染 `/api/openapi.json`） |
| `/knowledge-base/:id/graph` | 知识库知识图谱（实体/关系力导向探索） |
| `/admin/monitoring` | 可观测性监控面板（仅 Owner/Admin） |
| `/2fa-enroll` | 2FA 启用引导 |
| `/forgot-password` | 忘记密码 / 发起重置 |
| `/reset-password` | 重置密码 |
| `/invite` | 团队邀请落地页（签名 token，接受 / 拒绝加入工作区，需登录） |
| `/r/:id` | Agent 报告公开分享页 |
| `/share-doc/:token` | 文档分享链接公开页 |
| `/share-kb/:token` | 知识库分享链接公开页（整库只读浏览） |

> 目录与模块全貌见[项目结构](project-structure.md)；服务边界与数据流见[总体架构](../architecture/overview.md)；设计令牌与组件见 [UI 设计体系](../architecture/design-system.md)。

## 相关文档

- [快速开始](quickstart.md) — 5 分钟跑通核心链路
- [项目结构](project-structure.md) — 目录组织与代码导览
- [总体架构](../architecture/overview.md) — 服务边界 / 数据流 / 核心决策
- [UI 设计体系](../architecture/design-system.md) — 设计令牌 / 组件库 / 主题
- [设计与实现记录（归档）](../archive/design-and-implementation-log.md) — 各模块实现细节（历史追溯）

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.3.0 | 2026-11-05 | 删除过时的“系统架构图”ASCII（Vercel/Next.js 前端、NextAuth、LangChain/LangGraph、ChromaDB），改为指向架构上下两篇；「页面与技术栈对应关系总览」按 30 条实际路由重写为“页面模块与关键实现对照”（补代码位置，删除不存在的定价页/博客行、“难度”列与无真实通道的微信支付表述） |
| 1.2.0 | 2026-11-04 | 删除“完整页面清单”中等宽字符画的 P1～P25 原始规划草图（技术栈与页面细节已过时）；页面口径校正为 **30 个页面路由**（以 `frontend/src/router/index.ts` 为准），新增 `/invite` 邀请落地页；路由参数改用 Vue Router 的 `:id` / `:token` 写法；“新增 9 / 10 个路由 / 共 29 个”的算术矛盾改为按实际路由表表述 |
| 1.1.0 | 2026-09-23 | 删除过时的 8～12 周开发顺序与 2026-07-10 实现状态附录；页面口径更新为原始规划 25 项 / 当前 28 个路由 |
| 1.0.0 | 2026-08-20 | 初版（原《产品文档》） |
