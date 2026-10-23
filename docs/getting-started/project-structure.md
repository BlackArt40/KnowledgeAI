---
title: 项目结构
description: KnowledgeAI 目录组织与代码导览，帮助新成员快速定位代码
type: explanation
category: getting-started
level: L1
version: 1.1.0
authors:
  - product-team
owner: 技术负责人
reviewed_at: 2026-10-19
review_interval: 180
status: published
applies_to: ">=1.3.0"
---

# 📁 项目结构

> 本文档说明 KnowledgeAI 的目录组织，帮助新成员快速定位代码。
> 形态：**Vue 3 前端（`frontend/`）全量承载页面 + Next.js 纯 API（`src/`）**——前端绞杀重写（V0-V8）收官后的单仓双端结构。

## 顶层目录

```
KnowledgeAI/
├── frontend/             # Vue 3 前端（pnpm workspace 包 kai-frontend，28/28 页面）
├── src/                  # Next 纯 API（/api/** Route Handlers + 业务库 src/lib）
├── deploy/               # 部署资产（nginx 网关配置 + 前端切流路由表）
├── prisma/               # 数据库 schema + 迁移 + 种子数据
├── scripts/              # 运维脚本（切流/演练/迁移/清理）
│   └── smoke/            # 验收 smoke 套件（run-all.ts + manifest 分组调度，CI 会跑）
├── tests/                # 集成测试（需启动 dev server，用 node 运行）
├── e2e/                  # 根 Playwright 主流程套件（双 webServer，打 :4173 Vue DOM）
├── docs/                 # VitePress 文档中心（入门/架构/API/运维/FAQ/规范，历史文档在 archive/）
├── public/               # 静态资产单源（PWA sw.js/manifest、widget、swagger-ui vendor）
├── services/             # 拆分形态服务（business Java / ai Python，见 service-split.md）
├── sdk/                  # 三语言官方 SDK（JavaScript / Python / Go）
├── integrations/         # 集成产品（Chrome 扩展 / VS Code 扩展 / Embeddable Widget 说明）
├── k8s/                  # K8s 部署清单示例
├── deliverables/         # 工程保障与评审交付物（历史归档，非运行时依赖）
├── .github/workflows/    # CI 流水线（九 job：quality / unit / ai-contract / integration / e2e / docs / smoke / smoke-infra / frontend）
├── .tessdata/            # Tesseract OCR 语言包（首次 OCR 时下载，gitignored）
└── .uploads/             # 本地上传文件存储（demo 模式，gitignored）
```

## frontend/ — Vue 3 前端

```
frontend/
├── index.html                # 入口（首帧主题/语言预置脚本——防闪烁的唯一实现）
├── vite.config.ts            # Vite 7 配置（@shared 别名 → ../src/lib；^/api/ ^/vendor/ 代理）
├── src/
│   ├── main.ts               # 入口（Pinia + router + i18next-vue + EP 样式装配）
│   ├── App.vue               # 根组件（主题引擎 init + 路由出口）
│   ├── router/               # vue-router（28 路由 + 登录守卫 + 深链接）
│   ├── views/                # 页面（认证 6 / 工作台 / 知识库 / 团队 / 聊天 / Agent / 账务 / 管理端 / 开发者 / 门户）
│   ├── layouts/              # AuthLayout（认证壳）
│   ├── components/           # 业务组件（AppShell / chat/ 三件套 / marketing/ / ThemeSettings 等）
│   ├── lib/                  # 前端工具（markdown 渲染 / use-speech 语音 composables / i18n 胶水 / event-stream 长连接订阅 + presence + kb-events / error-reporter）
│   ├── api/                  # 类型化 API 客户端（与 /api 契约一一对应 + client.test.ts）
│   ├── stores/               # Pinia（主题 store 等薄封装）
│   ├── styles/               # tokens.css（设计令牌单源）+ element-adapter.css（EP 变量映射）
│   └── pwa/                  # Service Worker 注册（仅生产）
├── e2e/                      # 前端 Playwright 套件（31 用例：认证/工作台/知识库/聊天+Agent/管理端）
├── scripts/prerender-home.mjs # 首页 SEO 预渲染（build 末步产出 dist/home.html）
└── dist/                     # 构建产物（网关切流挂载 /srv/vue，gitignored）
```

> 共享资产**单源复用**：i18n 语言包（`src/lib/i18n/messages/`）、SSE 解析（`src/lib/sse.ts`）、主题引擎（`src/lib/theme/`）、格式化（`src/lib/format.ts`）经 `@shared` 别名引用，禁止拷贝到 frontend/。

## src/ — Next 纯 API + 业务库

```
src/
├── app/
│   ├── api/                      # API Route Handlers（Next 页面层已随 V6 退役，仅剩 API）
│   │   ├── auth/                 # 登录 / 注册 / me / OAuth / 2FA / 密码重置 / 邮箱验证
│   │   ├── knowledge-base/       # KB CRUD + 文档上传 / 删除 + 图谱 + 实时事件流（/events）
│   │   ├── upload/chunk/         # 分片上传（init / chunk / status / complete）
│   │   ├── chat/                 # SSE 流式问答
│   │   ├── agent/                # Agent 调研 SSE + 任务查询
│   │   ├── team/                 # 团队 / 成员 / 审计 / KB 权限
│   │   ├── billing/              # 套餐 / 订单 / webhook
│   │   ├── models/               # 外部 LLM 配置 / 测试 / 切换
│   │   ├── notifications/        # 通知收件箱 / 偏好
│   │   ├── security/             # 2FA / 会话 / 隐私 / GDPR 导出
│   │   ├── admin/                # 用户管理 / KB 监控 / 系统配置 / 清理 / 监控面板 / 日志
│   │   ├── v1/                   # 版本化 API（API Key scope 强制）
│   │   └── health/               # 存活 / 就绪 / DB 探针
│   └── layout.tsx                # 最小根 layout（App Router 编译必需）
│
├── lib/                          # 业务逻辑层（无 UI 依赖）
│   ├── auth/                     # JWT 鉴权 + RBAC 四角色 + OAuth（Auth.js 引擎 + kai-token 会话）
│   ├── kb/                       # 知识库 + 文档 CRUD + 处理管线触发
│   ├── rag/                      # RAG 引擎
│   │   ├── parser.ts             # 多格式解析（PDF/Word/Excel/PPT/HTML/OCR/字幕）
│   │   ├── ocr.ts                # Tesseract.js OCR（语言包在 .tessdata/）
│   │   ├── chunker.ts            # 智能切片（标题感知 / 表格代码保护）
│   │   ├── vector-store-*.ts     # 向量库适配器（memory/pgvector/chromadb/pinecone）
│   │   ├── bm25.ts               # BM25 关键词检索（miniSearch，CJK 分词）
│   │   ├── hybrid-search.ts      # 混合检索（向量 + BM25 经 RRF 融合）
│   │   ├── retriever.ts          # 检索入口（查询改写 → 多路混合 → 重排）
│   │   ├── generator.ts          # LLM 生成 + 引用组装
│   │   ├── indexer.ts            # 文档索引（解析→切片→嵌入→入库）
│   │   └── kg/ 相关：graph-rag.ts # GraphRAG 邻居扩展重排（与 kg/ 配合）
│   ├── agent/                    # Agent 调研编排（规划→检索→分析→撰写）
│   ├── external/                 # 外部数据源（Web 搜索 Tavily/SerpAPI/Brave + ArXiv + GitHub）
│   ├── chat/                     # 对话存储
│   ├── team/                     # 团队 / 成员 / 审计日志 / KB 权限
│   ├── billing/                  # 订阅 / 订单 / 发票 / 用量计量
│   ├── models/                   # 外部 LLM Provider 配置（per-user 上下文）
│   ├── llm/                      # LLM Provider 抽象（OpenAI/DeepSeek/... + 本地演示回退）
│   ├── notifications/            # 通知中心（4 通道 + 偏好）
│   ├── security/                 # 2FA(TOTP) / 审计链 / 隐私
│   ├── apikeys/                  # API Key 管理 + scope 强制
│   ├── admin/                    # 管理后台数据（用户 / KB 监控 / 系统配置）
│   ├── upload/                   # 分片上传会话管理
│   ├── storage/                  # 文件存储（本地 / S3）+ 清理任务
│   ├── queue/                    # 异步任务队列（Memory / BullMQ+Redis）
│   ├── email/                    # 邮件投递（Resend Provider + email-send 队列 job）
│   ├── integrations/             # 集成（Slack/飞书/钉钉机器人 + Notion/Confluence 同步）
│   ├── webhooks/                 # Webhook 引擎（HMAC 签名 + 重试 + 死信）
│   ├── openapi/                  # OpenAPI 3.0 规范（/api/openapi.json + /docs）
│   ├── realtime/                 # 实时协作（事件总线 + 在线状态）
│   ├── kg/                       # 知识图谱（NER 抽取 + GraphRAG + d3-force 布局）
│   ├── voice/                    # 语音 STT/TTS 封装（可注入纯函数，Vue 侧 @shared 复用）
│   ├── theme/                    # 主题引擎（三模式 + 高对比度 + 品牌色，Vue 侧 @shared 复用）
│   ├── i18n/                     # 国际化（i18next + zh-CN/en 语言包单源）
│   ├── obs/                      # 可观测（指标/追踪/错误上报/结构化日志 pino）
│   ├── health/                   # 健康检查（DB/Redis/LLM 连通性 + 告警状态机）
│   ├── workspace/                # 多租户 Workspace
│   ├── db/                       # Prisma 数据库层（client / hydrate / persist 写穿三件套）
│   ├── config.ts                 # Provider 状态聚合（管理面板数据源）
│   ├── crypto.ts                 # AES-256-GCM + HKDF（密文落库）
│   ├── secrets.ts                # AUTH_SECRET 解析（生产缺失拒绝启动）
│   ├── rate-limit.ts             # 分级限流（多维度 + Redis/内存双后端）
│   ├── format.ts                 # 本地化格式化（Vue 侧经 @shared/format 复用）
│   ├── roles.ts / ids.ts         # 角色常量 / id 生成（跨模块纯函数）
│   └── sse.ts                    # SSE 帧解析（前后端同构单源）
│
└── proxy.ts                      # 中间件（分级限流 + DB 水合触发）
```

## deploy/ — 部署资产

```
deploy/
├── nginx.conf                    # 网关主配置（/api → 业务；location / → Next 兜底）
├── env.split.example             # 拆分形态（网关 + business + ai）环境变量模板
├── moto.Dockerfile               # 本地演练用 AWS 服务替身镜像（S3 兼容端点）
├── .env.drill                    # 干净机器演练的本地 env（gitignored，不入库）
└── nginx/
    ├── routes.conf               # 前端切流路由表（27 条，单一事实源）
    └── frontend-switch.conf      # switch-frontend.sh 生成的 switch conf（随切流提交留审计轨迹）
```

> 切流唯一入口：`scripts/deploy/switch-frontend.sh`（list/apply/rollback/revert-all），见 [部署指南](../ops/deployment-guide.md)。

## 根目录关键文件

| 文件 | 作用 |
|------|------|
| `next.config.ts` | Next.js 配置（standalone 输出 / serverExternalPackages / 安全头） |
| `tsconfig.json` | 后端 TypeScript 配置（strict / `@/*` 别名；exclude frontend/） |
| `frontend/tsconfig.json` | 前端 TypeScript 配置（vue-tsc 独立门禁） |
| `package.json` | 后端依赖 + 脚本（pnpm@11.7.0 / Node 22） |
| `frontend/package.json` | 前端依赖 + 脚本（dev/build/preview/lint/typecheck/test/test:e2e） |
| `pnpm-workspace.yaml` | workspace 定义 + 原生构建白名单 + overrides 钉版 |
| `instrumentation.ts` + `instrumentation-node.ts` | 服务器启动钩子（启动队列 worker） |
| `worker.ts` | 独立 Worker 进程入口（Docker worker 服务） |
| `Dockerfile` | 多阶段构建（deps → build → minimal runner；standalone 剥离清单） |
| `docker-compose.yml` | 单体编排：app + worker + Redis + PostgreSQL（pgvector） |
| `docker-compose.split.yml` | 三服务拆分编排（网关 + business + ai + 基础设施） |
| `AGENTS.md` | AI 编辑会话指南（命令 / 架构 / 约定） |
| `.env.example` | 环境变量参考（含 demo fallback 文档；与 env-vars.md parity 门禁） |

## scripts/ — 运维脚本

```
scripts/
├── deploy/
│   ├── switch-frontend.sh       # 前端切流唯一入口（apply/rollback/revert-all）
│   ├── clean-machine-drill.sh   # 干净机器全栈演练（一键起 + 冒烟 + 切流段）
│   ├── staging.sh               # staging 部署（CI 调用）
│   └── blue-green.sh            # 生产蓝绿切换（健康检查门 + 自动回滚）
├── check-prisma-migrations.sh   # CI 迁移漂移检查（shell）
├── cleanup-temp-files.ts        # 临时文件清理（可配 cron）
├── cleanup-e2e-fixtures.ts      # 清理 e2e / 手工验证残留数据（对运行中的服务发 HTTP）
├── audit-auth-compat.ts         # 只读发布前检查（历史 AgentTask.shareConfig 兼容项）
├── generate-pwa-icons.ts        # 重新生成 public/icons（PWA 192/512/maskable/apple-touch）
├── migrate-vector-store.ts      # 内存索引批量迁移到向量库
├── tools/                       # CI 门禁 / 生成器（docs frontmatter、env parity、openapi、swagger-ui 拷贝）
├── local/                       # 本地测试数据准备（gitignored，不入库）
└── smoke/                       # 验收 smoke 套件（run-all.ts 按 lib/limits/http/ui/infra 分组调度）
    ├── run-all.ts               # runner：前置探测 + 分组 + 超时 + 报告（.report/）
    ├── lib/manifest.ts          # 脚本清单（分组 / 前置条件 / 超时）
    ├── test-parser.ts           # 多格式文档解析
    ├── test-ocr-*.ts            # OCR 图片 / 扫描 PDF
    ├── test-chunker.ts          # 智能切片
    ├── test-hybrid-search.ts    # 混合检索
    ├── test-graph-rag.ts        # 知识图谱 + GraphRAG 精度（环境自适应断言）
    ├── test-openapi.ts          # OpenAPI 规范 + /docs + v1 scope
    ├── test-webhooks.ts         # Webhook 签名 / 重试 / 死信
    ├── test-oauth.ts            # OAuth（mock OIDC + RS256）
    ├── test-{widget,graph,multimodal,theme,chat-enhance,global-search,mobile-pwa,i18n,monitoring}-ui.mjs
    │                            # ui 组（CDP 驱动 Chrome 打 :4173 Vue 页面）
    └── mock-pinecone-server.ts  # Pinecone mock 服务器（infra 组）
```

## tests/ — 集成测试

```
tests/
├── api/api-test.mjs             # API 路由全量覆盖（50+ 请求，含 SSE，纯 :3000）
├── functional/functional-test.mjs  # 页面壳 + API 流程检查（双基址：页面 :4173 / API :3000）
└── performance/performance-test.mjs  # 性能 + 限流
```

> 需先启动 `pnpm dev`（+ 前端 `pnpm -C frontend build && pnpm -C frontend exec vite preview --port 4173`），再用 `node tests/<suite>/<suite>-test.mjs` 运行。非单元测试框架，是冒烟 / 集成检查。

## prisma/ — 数据库

```
prisma/
├── schema.prisma                # PostgreSQL schema（模型 / 枚举 / 关系）
├── migrations/                  # 迁移文件（17 个，CI 检查漂移）
│   ├── 20260713022119_init/     # 初始迁移
│   └── …                        # P2~P8 迁移（2FA/审计/反馈/locale/品牌色/webhook/机器人/图谱/OAuth/密码重置/邮箱验证/租户持久化等）
└── seed.ts                      # 演示数据（4 用户 + 5 KB + 1 团队）
```
