<!-- 提交前请确认以下勾选项；与 CI 七项检查（quality/unit/integration/smoke/smoke-infra/e2e/docs）互补 -->

## 变更说明

<!-- 简述改动内容与动机 -->

## 自查清单

- [ ] `pnpm lint` 与 `npx tsc --noEmit` 本地通过
- [ ] 涉及 `src/lib/{rag,auth,billing,team}` 的新逻辑附带单元测试（覆盖率门槛 70%/60%）
- [ ] **验收 smoke**：新增/修改 `scripts/smoke/` 脚本时已登记到 `scripts/smoke/lib/manifest.ts`（分组 + 前置条件），并本地跑过对应分组（`pnpm test:smoke` 为 lib 组；http/ui/limits 组见 runner `--help`）
- [ ] **DB 迁移**：改动 `prisma/schema.prisma` 时已运行 `npx prisma migrate dev --name <描述>` 生成配套迁移（未改 Schema 可跳过）
- [ ] **文档影响**：新增/变更了环境变量、API、UI 文案或架构行为时，已同步更新对应文档（`docs/ops/env-vars.md`、`docs/api/*`、语言包等；无影响可跳过）
- [ ] 敏感操作路由已接入 `recordAudit`（如适用）
