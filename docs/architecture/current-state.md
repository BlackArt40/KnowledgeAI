---
title: 当前运行形态（单一事实源）
description: 2026-11-21 起的单镜像拓扑、本地双端起服、数据/队列语义、CI 与迁移口径；其他文档与此冲突时以本页为准
type: reference
category: architecture
level: L1
version: 1.0.0
authors:
  - tech-lead
owner: 技术负责人
reviewed_at: 2026-11-21
review_interval: 90
status: published
applies_to: ">=1.4.0"
related:
  - overview.md
  - system-design.md
  - ../ops/deployment-guide.md
  - ../ops/env-vars.md
  - adr/adr-0010-single-runtime-consolidation.md
---

# 当前运行形态（单一事实源）

> 本页是“现在代码怎么跑”的唯一入口。`system-design.md` 中保留的 nginx/Java/Python 拓扑属于历史，
> 与本文冲突时以本文为准。

## 1. 拓扑

```text
本地开发：Next API :3000  +  Vite :5173
生产：单个 Next 镜像 :3000
        ├─ /            → public/home.html（预渲染）
        ├─ /<spa-route> → public/index.html（Vue Router fallback）
        ├─ /api/**      → Next Route Handlers
        ├─ /assets/**   → Vue 构建产物
        └─ /sw.js, /manifest.webmanifest, /vendor/**, /widget/** → public/
      + 同镜像 worker 进程（node worker.js）
```

- Vue 页面不再是独立静态站；`pnpm build` 会把 `frontend/dist` 复制到根 `public/`。
- 没有 nginx 网关、Java 业务服务、Python AI 服务、Flyway、`deploy/` 或 `k8s/split.yaml`。
- 外部反向代理可选；若存在，`/api/*` 需关闭 buffering 并放宽 SSE 读超时。

## 2. 本地起服

```bash
pnpm install
pnpm dev                    # Next API :3000（演示模式，无需 env）
pnpm -C frontend dev        # Vue :5173，/api 代理到 :3000
```

生产预览：

```bash
pnpm build                  # frontend build → copy-vue-dist → next build
pnpm start                  # :3000，页面与 API 同源
```

> 不要执行 `pnpm build` 后再 `pnpm -C frontend build`；第二次构建不会重新复制到 `public/`，
> 会让 `next start` 继续使用旧页面。

## 3. 运行时模式

| 维度 | 默认（无配置） | 生产配置 |
|---|---|---|
| 数据 | `globalThis` 内存 store，重启即失 | `DATABASE_URL` + Prisma；启动 `hydrateFromDb()`，写内存后异步 `persistX()` |
| 队列 | 进程内队列，`QUEUE_CONSUMER=web` | `REDIS_URL` + BullMQ，独立 `worker` |
| 向量 | 内存向量 + BM25 | `VECTOR_STORE=pgvector`；`kb_chunks` 由 `vector-index-pgvector.ts` 运行时创建 |
| LLM | 本地抽取式回退 | `OPENAI_API_KEY` / `CHAT_MODEL` / `EMBEDDING_MODEL` |
| 认证 | demo 账号 + 自签 `kai-token` | 同一套 `AUTH_SECRET`；NextAuth 仅作 OAuth 协议引擎 |

**内存是读真源，DB 是恢复副本**。多实例或 worker 写入后需要 `loadXxxFromDb()` 补拉；不要把内存 store
当成跨进程共享状态。

## 4. 数据与迁移

- 唯一迁移来源：`prisma/migrations/`，当前 **26** 个目录。
- 历史 Flyway V1–V21 已删除；已有 `flyway_schema_history` 的库按 `docs/ops/migration-baseline.md` 做一次性基线。
- `kb_chunks` 是 pgvector 运行时表，不在 Prisma schema；基线审计会忽略它，不要删除。

## 5. CI 与门禁

- 8 个 job：`quality / unit / frontend / integration / smoke / smoke-infra / e2e / docs`。
- 覆盖率按 `vitest.config.ts` 的 per-directory ratchet；文档不再复述固定百分比。
- 分支保护：8 个 required check，0 approvals（solo maintainer）。
- `quality` 的 `pnpm build` 已覆盖 Vue 构建 + copy + Next 构建；不需要单独前端构建 job。

## 6. 仓库地图

| 路径 | 职责 |
|---|---|
| `src/app/api/**` | HTTP/SSE 路由；认证、校验、编排 |
| `src/lib/**` | 业务逻辑；15 个 `store.ts` 是内存仓储，`db/store-factories.ts` 定义统一空形状，`db/hydrate|persist` 负责 DB 映射；`sse-produce.ts` 统一 SSE 心跳/超时/关流 |
| `src/proxy.ts` | 限流 + CORS + trace + hydration 门；**不做认证** |
| `frontend/src/**` | Vue 页面、API 客户端、少量 Pinia（当前只有 theme） |
| `public/**` | PWA/vendor/widget 单源；`index.html`/`home.html`/`assets/` 是构建生成物 |
| `prisma/**` | schema + 迁移 + seed |
| `scripts/smoke/**` | 验收脚本；新脚本要登记到 `lib/manifest.ts` |

## 7. 历史文档（不要按此执行）

- `docs/architecture/service-split*.md`：拆分线退役通告。
- `docs/architecture/adr/adr-0008/0009`：superseded。
- `docs/archive/**`：历史设计日志/路线图。
- `deliverables/service-split/**`：拆分线验收归档。
- `docs/ops/migration-baseline.md` 的 Flyway 映射：只用于旧库一次性基线，不是当前 schema 来源。

## 8. 新人勿踩

1. 不要 `git add .`（会带进 `.codebuddy/`）。
2. 不要删 `public/sw.js`、`kb_chunks`、Next API、Prisma。
3. 新增 store 字段改 `db/store-factories.ts`；`ensureStores` 和各 `store()` 都从这里取空形状，漏改只会在 DB 模式重启后暴露。
4. `src/proxy.ts` 不是认证中间件；认证在 route/lib。
5. 租户过滤不是自动的：`canViewKb/canEditKb` 等需要调用方显式传 workspace。
