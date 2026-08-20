---
title: 新成员入门指南
description: KnowledgeAI 新成员第一天：开发环境搭建、代码导航、测试体系与提交第一个 PR 的完整路线
type: tutorial
category: getting-started
level: L1
version: 1.0.0
authors: [technical-writer]
owner: 技术负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [quickstart.md, project-structure.md, contribution-guide.md, ../architecture/overview.md]
---

# 新成员入门指南

> 目标：**一天内**完成环境搭建、跑通全链路、读懂代码导航，并提交第一个符合门禁的 PR。文中的「你」= 新加入 KnowledgeAI 团队的开发者。

## 上午：环境搭建与全链路体验（约 3 小时）

### 1. 开发环境（30 分钟）

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | 22+ | 运行时（`nvm` 或 [官网](https://nodejs.org/)） |
| pnpm | 11.7.0 | 包管理器（`corepack enable`，项目 `packageManager` 已锁定） |
| Git | — | 仓库克隆与分支 |

```bash
git clone <your-repo-url> && cd KnowledgeAI
pnpm install          # 依赖安装（含 postinstall 复制 Swagger UI）
pnpm dev              # 开发服务器 :3000
```

### 2. 全链路体验（1 小时）

按 [快速开始](quickstart.md) Step 3-6 用演示账号走一遍：登录 → 建知识库 → 上传文档 → 智能问答 → Agent 调研。**重点观察**：

- 问答的流式输出与引用溯源（`[n]` 角标联动来源面板）；
- Agent 的四阶段时间线（规划 → 检索 → 分析 → 写作）；
- 管理后台 `/admin` 的 Provider 状态面板（哪些真实服务已启用、哪些在演示回退）。

### 3. 项目结构导览（1.5 小时）

通读 [项目结构](project-structure.md) 与 [总体架构](../architecture/overview.md)，记住三个关键认知：

1. **读走内存、写穿 DB**：领域数据在 `globalThis` 内存 Store（读路径事实源），PostgreSQL 只做持久化；
2. **Provider 配置即切换**：`src/lib/*/provider.ts` 是真实服务门控，未配置自动回退演示模式；
3. **队列驱动长任务**：文档处理 / Agent 调研在后台队列执行，SSE 经事件总线推送。

## 下午：开发与提交（约 4 小时）

### 4. 测试体系认知（45 分钟）

| 套件 | 命令 | 说明 |
|------|------|------|
| 单元测试 | `pnpm test:unit` | vitest + 覆盖率门槛（lines 70% / branches 60%，覆盖 `src/lib/{rag,auth,billing,team}`） |
| 集成测试 | `node tests/<suite>/<suite>-test.mjs` | 需先启动 `pnpm dev`，用演示账号打真实 API |
| E2E | `pnpm test:e2e` | Playwright，自动启动 dev server |

> 新增 `src/lib/{rag,auth,billing,team}` 代码**必须配测试**，否则 CI 覆盖率门槛会挂。

### 5. 提交流程（1.5 小时）

1. **分支**：`git checkout -b feat/<你的功能>`（或 `fix/`）；
2. **本地门禁自检**：

   ```bash
   pnpm lint            # ESLint，必须零告警
   pnpm test:unit       # 覆盖率达标
   npx tsc --noEmit     # 类型检查（CI 跑的就是这个）
   ```

3. **提交 PR**：按 PR 模板填写，勾选「文档影响」（改了 `src/lib/` 模块或 API → 必须同步更新对应文档，见 [文档编写规范](../standards/doc-writing-standards.md)）；
4. **等待 CI**：5 个 job 全绿（quality / unit / integration / e2e / docs）才能合并。改动 `prisma/schema.prisma` 必须先生成迁移（`npx prisma migrate dev --name <描述>`）。

### 6. 第一个 PR 建议（45 分钟）

- 从「小而真」入手：修复一个 bug、补一个测试、优化一处文档；
- 在 PR 描述里写清「改了什么 / 为什么 / 如何验证」；
- 主动 @ 模块 Owner 评审，评审清单见 [文档评审 Checklist](../standards/doc-review-checklist.md)。

## 常见卡点速查

| 现象 | 处理 |
|------|------|
| `pnpm dev` 启动报错 | 检查 Node 22+ 与 pnpm 版本（`pnpm -v` 应为 11.7.0） |
| 问答答非所问 | 确认文档已处理完成（`kb.ready`）；未配置真实 LLM 时是演示模式生成 |
| 上传 EACCES | 见 [故障排查](../faq/troubleshooting.md) 第 4 条 |
| CI 覆盖率挂了 | 补 `src/lib/{rag,auth,billing,team}` 的单测 |
| 不知道改哪里 | 先读 [项目结构](project-structure.md) + [总体架构](../architecture/overview.md)，再问模块 Owner |

## 今日产出清单

- [ ] 环境搭建完成，`pnpm dev` 可运行
- [ ] 跑通「上传 → 问答 → Agent」全链路
- [ ] 读完项目结构与架构文档
- [ ] 提交 1 个 PR 并通过 CI

## 相关文档

- [快速开始](quickstart.md) · [项目结构](project-structure.md) · [贡献指南](contribution-guide.md)
- [总体架构](../architecture/overview.md) · [文档编写规范](../standards/doc-writing-standards.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版 |
