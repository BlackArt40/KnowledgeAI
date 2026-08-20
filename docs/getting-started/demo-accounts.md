---
title: 演示账号与数据
description: KnowledgeAI 演示账号清单、权限范围与演示数据说明
type: reference
category: getting-started
level: L1
version: 1.0.0
authors: [technical-writer]
owner: 技术文档负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [quickstart.md, ../architecture/overview.md]
---

# 演示账号与数据

> 演示账号用于本地开发与测试，密码均为 `password123`。**请勿在生产环境保留演示账号**（`prisma/seed.ts` 仅在演示/开发模式使用）。

## 账号清单

| 邮箱 | 角色 | 权限范围 | 适合体验 |
|------|------|----------|----------|
| `owner@knowledgeai.dev` | Owner | 全部权限（含管理后台） | 全功能 + `/admin` 管理面板 |
| `admin@knowledgeai.dev` | Admin | KB 管理 + 成员管理 | 团队与权限管理 |
| `editor@knowledgeai.dev` | Editor | KB 编辑 + 问答 + Agent | 日常使用主视角 |
| `viewer@knowledgeai.dev` | Viewer | KB 只读 + 问答 | 只读视角验证 RBAC |

## 演示数据

运行 `pnpm dev` 并完成种子（可选）后，演示环境预置：

- **5 个知识库**（含示例文档，覆盖不同主题）；
- **1 个团队**（含跨角色成员，便于体验协作与权限）；
- 若干示例会话与 Agent 任务历史。

> 种子数据通过 `npx prisma db seed` 写入（演示模式默认内存启动时自动加载）；数据随服务重启重置（未配置 `DATABASE_URL` 时）。

## 自行注册

登录/注册页支持邮箱注册，新账户默认 **Editor** 角色。OAuth（Google / GitHub）按钮在未配置 `GOOGLE_CLIENT_ID` / `GITHUB_CLIENT_ID` 时自动隐藏（见[环境变量全表](../ops/env-vars.md)）。

## 注意事项

1. **密码弱**：演示密码为固定值，仅限本地开发；
2. **角色即测试用例**：RBAC 四角色覆盖了「Owner / Admin / Editor / Viewer」权限矩阵，测试权限时按角色登录对比即可；
3. **不要改种子账号**：测试脚本（tests/ 与 smoke）依赖这些账号，改动会导致集成测试失败。

## 相关文档

- [快速开始](quickstart.md)（Step 3 登录）
- [新成员入门指南](onboarding.md)
- [总体架构](../architecture/overview.md)（RBAC 说明）

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版 |
