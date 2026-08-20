---
title: 贡献指南
description: KnowledgeAI 代码与文档贡献流程：分支、本地门禁、PR 评审与文档同步要求
type: how-to
category: getting-started
level: L1
version: 1.0.0
authors: [technical-writer]
owner: 技术负责人
reviewed_at: 2026-08-20
review_interval: 180
status: published
applies_to: ">=1.2.0"
related: [onboarding.md, ../standards/doc-writing-standards.md, ../standards/doc-review-checklist.md]
---

# 贡献指南

> 本文定义 KnowledgeAI 的代码与文档贡献流程。核心原则：**文档与代码同 PR（docs-as-code）**、**CI 五门禁全绿才可合并**、**破坏性变更必须有迁移/文档**。

## 分支与版本策略

| 分支 | 用途 | 合并来源 |
|------|------|----------|
| `main` | 主干（保护分支） | 仅 feature PR，需 CI 全绿 + 评审通过 |
| `feat/<name>` / `fix/<name>` | 功能 / 修复 | 从 `main` 拉出 |

- 提交信息建议遵循**约定式提交**：`feat:` / `fix:` / `docs:` / `test:` / `chore:` 前缀 + 一句话描述（如 `feat(rag): 支持重排候选池配置`）；
- 小改动也可直接 `docs:` 提交，但**任何改动不得绕过 PR 评审直接 push main**。

## 本地门禁（push 前必跑）

```bash
pnpm lint            # ESLint，零告警
pnpm test:unit       # vitest，覆盖率门槛：lines/functions/statements 70%、branches 60%
npx tsc --noEmit     # 类型检查（CI quality job 实际执行项）
```

> 改了 `prisma/schema.prisma`？**先** `npx prisma migrate dev --name <描述>` 生成迁移，否则 CI 的 `prisma migrate diff --exit-code` 会挂。

## PR 流程

1. **创建 PR**：从 `feat/*` 分支指向 `main`，标题用约定式前缀；
2. **模板填写**：改动内容 / 动机 / 验证方式（贴测试输出或截图）；
3. **「文档影响」勾选**：
   - 改了 `src/lib/` 模块 → 同步更新 [架构文档](../architecture/overview.md) 对应章节；
   - 改了 `src/lib/openapi/spec.ts` 或 v1 路由 → 重跑 `npx tsx scripts/tools/gen-api-reference.ts` 更新 [API 参考](../api/reference.md)（CI 漂移检查会强制）；
   - 改了环境变量 → 同步 [环境变量全表](../ops/env-vars.md)；
   - 新增/移除功能 → 更新 [FAQ](../faq/faq.md) 或文档清单；
4. **评审**：至少 1 人 approve（L2+ 文档需技术文档负责人审语言）；评审人按 [文档评审 Checklist](../standards/doc-review-checklist.md) 核对；
5. **CI 五门禁**：quality / unit / integration / e2e / **docs** 全绿后合并。

## CI 五门禁速览

| Job | 检查内容 | 常挂原因 |
|-----|----------|----------|
| quality | tsc + lint + build + prisma 迁移漂移 | schema 改了没生成迁移 |
| unit | vitest 覆盖率门槛 | `src/lib/{rag,auth,billing,team}` 新代码没配测试 |
| integration | 功能/API/性能套件（需 dev server） | 破坏既有 API 契约 |
| e2e | Playwright 主流程 | 前端行为回归 |
| docs | 站点构建（死链）+ Frontmatter 校验 + OpenAPI 漂移 | 文档缺元数据 / 引用失效 / API 变了没重生成参考 |

## 文档贡献规范

- 新文档用 [新文档模板](../standards/templates/new-doc.md)（含 Frontmatter 元数据）；
- 术语统一查 [术语表](../standards/glossary.md)；
- 文档随 PR 走，评审用 [文档评审 Checklist](../standards/doc-review-checklist.md)；
- 不维护已过期文档：`owner` 负责复审（默认 180 天周期），超期文档自动标注。

## 测试编写约定

- **单测**：纯函数优先；LLM 路径用 `vi.mock("@/lib/llm/provider")`；重依赖（pdfjs/mammoth/xlsx）用 `vi.mock`；
- **集成**：`tests/<suite>/<suite>-test.mjs` 打 live dev server（用演示账号）；
- **E2E**：`e2e/main-flow.spec.ts` 覆盖登录 → 上传 → 问答 → Agent；受控输入需 fill-verify-retry 循环（React hydration 竞态）。

## 相关文档

- [新成员入门指南](onboarding.md) · [快速开始](quickstart.md)
- [文档编写规范](../standards/doc-writing-standards.md) · [文档评审 Checklist](../standards/doc-review-checklist.md)

## 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-20 | 初版 |
