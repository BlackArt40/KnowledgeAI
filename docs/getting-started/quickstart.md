---
title: 快速开始
description: KnowledgeAI 5 分钟起步：环境要求、启动服务、演示账号登录、上传文档到智能问答的完整流程
type: tutorial
category: getting-started
level: L2
version: 1.0.0
authors: [technical-writer]
owner: 技术文档负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [onboarding.md, demo-accounts.md, ../standards/glossary.md]
---

# 快速开始

> 本教程带你 **5 分钟跑通核心链路**：启动服务 → 登录 → 上传文档 → 智能问答 → Agent 调研。完成后你就有了第一手体验，可以继续阅读 [onboarding](onboarding.md) 深入开发。

## 你会得到什么

一个运行在 `http://localhost:3000` 的 KnowledgeAI 实例，包含：演示账号登录、一个可检索的知识库、一次带引用的智能问答、一份 Agent 生成的调研报告。

## 前置条件

- [ ] **Node.js 22+**（[下载](https://nodejs.org/)）
- [ ] **pnpm 11.7.0**（`corepack enable` 后自动使用项目锁定版本）
- [ ] 可选：PostgreSQL（生产化数据持久化）与 Redis（分布式限流/队列）——**不装也能跑**（自动演示模式）

## Step 1：安装依赖（约 1 分钟）

```bash
git clone <your-repo-url> && cd KnowledgeAI
pnpm install
```

项目使用 `pnpm@11.7.0`（`packageManager` 锁定），首次安装会自动执行 postinstall 复制 Swagger UI 资源。

## Step 2：启动开发服务器（约 30 秒）

```bash
pnpm dev
```

看到 `Ready in ...` 后，打开 **`http://localhost:3000`**。

> **演示模式说明**：未配置 `DATABASE_URL` 时数据存在内存中，**重启即失**——这是设计行为（配置即切换）。需要持久化见 [部署指南](../ops/deployment-guide.md)。

## Step 3：用演示账号登录

登录页提供 4 个演示账号（密码均为 `password123`），推荐用 **Owner** 体验全部功能：

| 邮箱 | 角色 | 权限 |
|------|------|------|
| `owner@knowledgeai.dev` | Owner | 全部权限（含管理后台） |
| `admin@knowledgeai.dev` | Admin | KB 管理 + 成员管理 |
| `editor@knowledgeai.dev` | Editor | KB 编辑 + 问答 + Agent |
| `viewer@knowledgeai.dev` | Viewer | KB 只读 + 问答 |

也可自行注册（默认 Editor 角色）。完整说明见 [demo-accounts](demo-accounts.md)。

## Step 4：创建知识库并上传文档

1. 进入「知识库」页 → 点击「新建」，命名如「我的文档」；
2. 上传一份文档（支持 PDF / Word / Excel / PPT / Markdown / 图片 / 视频字幕等 8+ 格式）；
3. 等待处理完成（状态徽标从「处理中」变为就绪，内部触发 `kb.ready` 事件）。

> **验证**：知识库详情页应显示文档已解析、切片并索引（处理进度条走完）。

## Step 5：智能问答（带引用溯源）

进入「问答」页，选择刚建的知识库，输入问题（如「这份文档主要讲了什么？」）。

你会看到：
- **流式输出**（SSE 逐字返回，非等待式）；
- **引用角标** `[1] [2]`：点击可高亮右侧来源面板的原文片段；
- **反馈按钮**：点赞/点踩可调优后续检索（负反馈降权闭环）。

## Step 6：Agent 调研（可选，体验多 Agent 编排）

进入「Agent 调研」页，输入主题（如「RAG 技术原理」），观察四阶段时间线：

```
规划 Agent → 检索 Agent → 分析 Agent → 写作 Agent
```

完成后获得一份 Markdown 报告，可导出 PDF / PPTX / 思维导图、分享或评论。

## 收尾：你做了什么

你已跑通 KnowledgeAI 的核心闭环：**上传文档 → AI 构建知识库 → 团队智能问答 → 自动生成调研报告**。

## 下一步

- [onboarding：新成员第一天](onboarding.md) — 深入开发环境与代码导航
- [项目结构](project-structure.md) — 目录组织与代码导览
- [部署指南](../ops/deployment-guide.md) — 从演示模式切换到生产部署
- [API 使用指南](../api/guide.md) — 用 API/SDK 集成

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版 |
