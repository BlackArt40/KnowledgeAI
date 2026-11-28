<!-- 提交前请确认以下勾选项；与 CI 七项检查（quality/unit/frontend/integration/smoke/smoke-infra/e2e）互补 -->

## 变更说明

<!-- 简述改动内容与动机 -->

## 自查清单

- [ ] `pnpm lint` 与 `npx tsc --noEmit` 本地通过
- [ ] 新增/改动的 `src/lib/**` 逻辑附带单元测试（覆盖率硬门槛见 `vitest.config.ts`：全局 floor + 分目录 ratchet）
- [ ] **验收 smoke**：新增/修改 `scripts/smoke/` 脚本时已登记到 `scripts/smoke/lib/manifest.ts`（分组 + 前置条件），并本地跑过对应分组（`pnpm test:smoke` 为 lib 组；http/ui/limits 组见 runner `--help`）
- [ ] **DB 迁移**：改动 `prisma/schema.prisma` 时已运行 `npx prisma migrate dev --name <描述>` 生成配套迁移（未改 Schema 可跳过）
- [ ] **配置影响**：新增/变更环境变量时已同步更新 `.env.example`（该文件是环境变量的唯一事实源；内部文档不随仓库提交）
- [ ] 敏感操作路由已接入 `recordAudit`（如适用）
