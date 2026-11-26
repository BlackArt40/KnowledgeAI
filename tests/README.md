# KnowledgeAI · 测试套件

> 三套独立的 Node 验收脚本：功能测试、接口测试、性能测试。每套运行后在自己的目录下生成一份中文命名的 Markdown 报告（报告不入库）。

这三套脚本是「打真实服务」的验收层，和另外几层测试的分工：

| 层 | 入口 | 打什么 |
| --- | --- | --- |
| 单元测试 | `pnpm test:unit` | vitest，`src/lib/**` 与 `packages/shared/**` |
| 真实数据库测试 | `pnpm test:db` | vitest，需要 `DATABASE_URL` |
| 本目录 | `pnpm test:integration` | 运行中的 Next API（:3000）与 vite preview（:4173） |
| 冒烟验收 | `pnpm test:smoke`、`pnpm test:smoke:all` | `scripts/smoke/`，分 lib / limits / http / ui / infra 五组 |
| 浏览器端到端 | `pnpm test:e2e`、`pnpm -C frontend test:e2e` | Playwright |

## 运行

先起两个服务。Next 只提供 `/api/*`，页面由 Vue 构建产物的 preview 承载：

```bash
pnpm dev                                                   # Next API，:3000
pnpm -C frontend build && pnpm -C frontend exec vite preview --port 4173   # 页面，:4173
```

再逐个运行：

```bash
node tests/functional/functional-test.mjs     # 页面壳 + 5 条 API 流程
node tests/api/api-test.mjs                   # 约 15s，API 路由与 SSE
node tests/performance/performance-test.mjs   # 约 120s，含限流窗口等待
```

`pnpm test:integration` 依次跑这三条，但不会替你拉起服务。

基址可用环境变量覆盖：API 用 `KAI_TEST_BASE`（默认 `http://localhost:3000`），页面用 `PAGE_BASE`（默认 `http://localhost:4173`）。共用工具（`login` / `api` / `BASE` / `AUTH`）在 `tests/helpers.mjs`。

## 各套内容

### 功能测试 `functional/functional-test.mjs`

- **页面检查**：从 :4173 取页面，断言 Vue SPA 壳标记 `id="app"`（除预渲染首页外页面都是客户端渲染，没有服务端渲染内容可断言）。
- **API 流程**：知识库 → SSE 问答 → 引用返回；计费下单与订阅；API 密钥增删；2FA 开关；管理后台封禁与解封。

### 接口测试 `api/api-test.mjs`

按模块逐个打 `/api/*`：知识库、问答、Agent、团队、计费、密钥、安全隐私、管理后台，以及错误用例。SSE 用例断言 `/api/chat` 的 `token` / `done` 帧与 `/api/agent/run` 的 `init` / `step` / `done` 帧。

### 性能测试 `performance/performance-test.mjs`

对运行中的服务取延迟样本：API 基准（avg / P50 / P95）、SSE 首 token 延迟、并发、限流阈值、写操作。结果是观察值，不是门禁；CI 的延迟门禁在 `.github/workflows/ci.yml` 的 `integration` job 里。

## 注意

- 脚本使用演示账号登录，并会创建知识库、订单等数据。本地限流默认档位较低，连续跑容易触发 429；需要时可按 `docs/ops/env-vars.md` 调高 `RATE_LIMIT_*`。
- 脚本用演示账号登录，只适用于本地或 CI 的一次性环境。
