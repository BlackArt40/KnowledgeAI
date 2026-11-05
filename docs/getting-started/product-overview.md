---
title: 产品概述
description: KnowledgeAI 产品概述：产品定位、核心技术栈、页面与技术栈对应关系，以及后续迭代新增的页面路由与现状架构图
type: explanation
category: getting-started
level: L1
version: 1.2.0
authors:
  - product-team
owner: 产品负责人
reviewed_at: 2026-11-04
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

| 页面               | 核心技术                        | 难度  |
| ------------------ | ------------------------------- | :---: |
| 落地页/定价页/博客 | Vue 3 + 构建期预渲染 + SEO      |  ⭐⭐   |
| 登录/注册/验证     | NextAuth + OAuth + JWT          |  ⭐⭐   |
| 仪表盘             | 数据聚合 + 手绘 SVG 图表        |  ⭐⭐⭐  |
| 知识库管理         | 文件上传 + 异步处理 + 状态管理  |  ⭐⭐⭐  |
| **智能问答**       | **RAG 全流程 + 流式输出**        | ⭐⭐⭐⭐  |
| **Agent 调研**      | **多 Agent StateGraph + 任务队列** | ⭐⭐⭐⭐⭐ |
| 团队管理           | RBAC + 多租户隔离               | ⭐⭐⭐⭐  |
| 订阅计费           | Stripe/微信支付 + 状态机        | ⭐⭐⭐⭐  |
| 用量统计           | 计量系统 + 数据可视化           |  ⭐⭐⭐  |
| API 密钥            | API 网关 + 限流 + 日志           |  ⭐⭐⭐  |
| 安全设置           | 2FA + 会话管理 + GDPR           |  ⭐⭐⭐  |
| 管理后台           | 权限校验 + 数据看板             |  ⭐⭐⭐  |
| 隐私/条款          | 合规文档 + 法律文本             |   ⭐   |

---

## 系统架构图

```
                          ┌─────────────┐
                          │   用户浏览器   │
                          └──────┬──────┘
                                 │
                          ┌──────▼──────┐
                          │   Vercel     │  ← 前端部署
                          │  (Next.js)   │
                          └──────┬──────┘
                                 │
                    ┌────────────▼────────────┐
                    │      API Gateway         │  ← 限流/认证
                    │   (Next.js API Routes)   │
                    └────────────┬────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
   ┌──────▼──────┐      ┌───────▼──────┐      ┌───────▼──────┐
   │  Auth 服务   │      │  RAG 服务     │      │ Agent 服务   │
   │ (NextAuth)  │      │ (LangChain)  │      │(LangGraph)  │
   └──────┬──────┘      └───────┬──────┘      └───────┬──────┘
          │                     │                     │
          │             ┌───────▼──────┐      ┌───────▼──────┐
          │             │  向量数据库    │      │  任务队列     │
          │             │ (ChromaDB)   │      │(BullMQ+Redis)│
          │             └──────────────┘      └──────────────┘
          │
   ┌──────▼──────┐      ┌──────────────┐     ┌──────────────┐
   │ PostgreSQL  │      │    Redis      │     │  对象存储     │
   │ (主数据库)   │      │   (缓存)      │     │ (文档存储)    │
   └─────────────┘      └──────────────┘     └──────────────┘
```

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
| 1.2.0 | 2026-11-04 | 删除“完整页面清单”中等宽字符画的 P1～P25 原始规划草图（技术栈与页面细节已过时）；页面口径校正为 **30 个页面路由**（以 `frontend/src/router/index.ts` 为准），新增 `/invite` 邀请落地页；路由参数改用 Vue Router 的 `:id` / `:token` 写法；“新增 9 / 10 个路由 / 共 29 个”的算术矛盾改为按实际路由表表述 |
| 1.1.0 | 2026-09-23 | 删除过时的 8～12 周开发顺序与 2026-07-10 实现状态附录；页面口径更新为原始规划 25 项 / 当前 28 个路由 |
| 1.0.0 | 2026-08-20 | 初版（原《产品文档》） |
